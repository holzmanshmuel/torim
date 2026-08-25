'use server';

/**
 * Server Actions behind a customer's own manage link.
 *
 * The manage token *is* the credential — 256 bits, minted by the database, resolved
 * through the narrow SECURITY DEFINER function in `@/lib/manage`. There is no session
 * and no other proof of identity, which has two consequences these actions must respect:
 *
 *  - An unresolvable token returns exactly the same shape as a resolvable one belonging
 *    to nothing bookable. A caller learns only that their own request failed.
 *  - Writes are rate limited per address, because a token is the only thing standing
 *    between an attacker and someone else's appointment, and 2^256 is only unguessable
 *    if guessing is also slow.
 */
import { headers } from 'next/headers';
import { getAvailability } from '@/lib/availability';
import { BookingConflictError, CancellationTooLateError } from '@/lib/booking';
import { getLang } from '@/lib/i18n';
import {
  cancelByManageToken,
  findBookingByManageToken,
  rescheduleByManageToken,
} from '@/lib/manage';
import { SlotNotAvailableError } from '@/lib/public-booking';
import { runWithTenant } from '@/lib/tenant';
import { addDays, instantToDateKey } from '@/lib/time';
import {
  invalidRequestError,
  notFoundError,
  rateLimitedError,
  slotTakenError,
  tooLateToCancelError,
  unexpectedError,
} from '../b/lib/errors';
import { pickName } from '../b/lib/format';
import {
  availabilityLimiter,
  clientAddress,
  manageWriteLimiter,
} from '../b/lib/rate-limits';
import type { ActionResult, AvailabilityPayload, BookingStatus } from '../b/lib/types';
import { parseDateRange, parseInstant, parseManageToken } from '../b/lib/validate';

export type ManageAvailabilityQuery = { token: string; from: string; to: string };
export type ManageCancelInput = { token: string };
export type ManageRescheduleInput = { token: string; startsAt: string };

function loose<T extends object>(input: T): Partial<Record<keyof T, unknown>> {
  return (input ?? {}) as Partial<Record<keyof T, unknown>>;
}

const CHANGEABLE: readonly BookingStatus[] = ['pending', 'confirmed'];

/**
 * Availability for rescheduling this booking.
 *
 * `excludeBookingId` is the whole point: without it a booking blocks its own move and
 * the customer can never shift by one slot — the appointment they are trying to move is
 * counted as busy against itself.
 */
export async function loadManageAvailability(
  input: ManageAvailabilityQuery,
): Promise<ActionResult<AvailabilityPayload>> {
  const lang = await getLang();
  const raw = loose(input);

  const token = parseManageToken(raw.token);
  const range = parseDateRange(raw.from, raw.to);
  if (!token || !range) return invalidRequestError(lang);

  const gate = availabilityLimiter.check(`manage-availability:${clientAddress(await headers())}`);
  if (!gate.allowed) return rateLimitedError(lang, gate.retryAfterMs);

  try {
    const found = await findBookingByManageToken(token);
    if (!found) return notFoundError(lang);

    const { business, service, booking } = found;
    const now = new Date();
    const today = instantToDateKey(now, business.timezone);
    const horizon = addDays(today, business.maxAdvanceDays);

    const from = range.from < today ? today : range.from;
    if (from > range.to) return { ok: true, days: [], today, horizon };

    const days = await runWithTenant(business.id, () =>
      getAvailability({
        businessId: business.id,
        serviceId: service.id,
        from,
        to: range.to,
        now,
        excludeBookingId: booking.id,
      }),
    );

    return {
      ok: true,
      today,
      horizon,
      days: days.map((day) => ({
        date: day.date,
        state: day.state,
        slots: day.slots.map((slot) => slot.toISOString()),
      })),
    };
  } catch (err) {
    console.error('loadManageAvailability failed', err);
    return unexpectedError(lang);
  }
}

export async function cancelAppointment(
  input: ManageCancelInput,
): Promise<ActionResult<{ status: BookingStatus }>> {
  const lang = await getLang();
  const token = parseManageToken(loose(input).token);
  if (!token) return invalidRequestError(lang);

  const gate = manageWriteLimiter.check(`manage-write:${clientAddress(await headers())}`);
  if (!gate.allowed) return rateLimitedError(lang, gate.retryAfterMs);

  try {
    const found = await findBookingByManageToken(token);
    if (!found) return notFoundError(lang);
    if (!CHANGEABLE.includes(found.booking.status)) return invalidRequestError(lang);

    const booking = await cancelByManageToken({ token });
    return { ok: true, status: booking.status };
  } catch (err) {
    if (err instanceof CancellationTooLateError) {
      const found = await findBookingByManageToken(token);
      const businessName = found
        ? pickName(lang, found.business.name, found.business.nameHe)
        : '';
      return tooLateToCancelError(lang, businessName, err.windowMinutes);
    }
    console.error('cancelAppointment failed', err);
    return unexpectedError(lang);
  }
}

export async function rescheduleAppointment(
  input: ManageRescheduleInput,
): Promise<ActionResult<{ startsAt: string; endsAt: string; status: BookingStatus }>> {
  const lang = await getLang();
  const raw = loose(input);

  const token = parseManageToken(raw.token);
  const startsAt = parseInstant(raw.startsAt);
  if (!token || !startsAt) return invalidRequestError(lang);

  const gate = manageWriteLimiter.check(`manage-write:${clientAddress(await headers())}`);
  if (!gate.allowed) return rateLimitedError(lang, gate.retryAfterMs);

  try {
    const found = await findBookingByManageToken(token);
    if (!found) return notFoundError(lang);
    if (!CHANGEABLE.includes(found.booking.status)) return invalidRequestError(lang);

    const booking = await rescheduleByManageToken({ token, startsAt });
    return {
      ok: true,
      status: booking.status,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
    };
  } catch (err) {
    if (err instanceof SlotNotAvailableError) return slotTakenError(lang);
    if (err instanceof BookingConflictError) return slotTakenError(lang);
    console.error('rescheduleAppointment failed', err);
    return unexpectedError(lang);
  }
}
