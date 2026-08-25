'use server';

/**
 * Server Actions for the public booking page.
 *
 * These are POST endpoints. The booking UI is not a gate — anyone who can send the same
 * request reaches them directly, with no session, no cookie and nothing to authenticate.
 * So:
 *
 *  - every field is parsed by `./lib/validate` before it can reach a query (a date like
 *    `2026-02-31` never becomes a `::date` cast);
 *  - the business is addressed by *slug*, never by an id supplied by the caller, so a
 *    tampered payload cannot aim a write at another tenant;
 *  - every tenant-scoped call runs inside `runWithTenant`;
 *  - both endpoints are rate limited, and a rejection says so in words rather than
 *    looking like an empty calendar;
 *  - expected failures are returned as localised data, never thrown (see `./lib/types`).
 */
import { headers } from 'next/headers';
import { getAvailability, getService } from '@/lib/availability';
import { BookingConflictError } from '@/lib/booking';
import { findBusinessBySlug } from '@/lib/businesses';
import { getLang } from '@/lib/i18n';
import { InvalidPhoneError, normalisePhone } from '@/lib/phone';
import {
  bookPublicly,
  CustomerBlockedError,
  SlotNotAvailableError,
} from '@/lib/public-booking';
import { runWithTenant } from '@/lib/tenant';
import { addDays, instantToDateKey } from '@/lib/time';
import {
  blockedError,
  fieldError,
  invalidRequestError,
  notFoundError,
  rateLimitedError,
  slotTakenError,
  unexpectedError,
} from './lib/errors';
import { pickName } from './lib/format';
import {
  availabilityLimiter,
  bookingIpLimiter,
  bookingPhoneLimiter,
  clientAddress,
} from './lib/rate-limits';
import type { ActionResult, AvailabilityPayload, ConfirmationDto } from './lib/types';
import {
  MAX_NAME_LENGTH,
  parseDateRange,
  parseEmail,
  parseInstant,
  parseName,
  parseNote,
  parsePhoneInput,
  parseSlug,
  parseUuid,
} from './lib/validate';

export type AvailabilityQuery = {
  slug: string;
  serviceId: string;
  /** Business-local date keys, inclusive. */
  from: string;
  to: string;
};

export type BookingSubmission = {
  slug: string;
  serviceId: string;
  /** ISO 8601 with an explicit offset. */
  startsAt: string;
  name: string;
  phone: string;
  /**
   * Optional, and only meaningful when the business turned `ask_customer_email` on.
   * Ignored outright otherwise — see `submitBooking`.
   */
  email?: string;
  note?: string;
};

/** Anything arriving from the network is `unknown` until `./lib/validate` says otherwise. */
function loose<T extends object>(input: T): Partial<Record<keyof T, unknown>> {
  return (input ?? {}) as Partial<Record<keyof T, unknown>>;
}

/**
 * Availability for one service over a date range.
 *
 * Days already in the past are dropped rather than generated: the slot engine would
 * label them `too_soon` (every slot falls inside the notice window), and "too soon to
 * book" is a confusing thing to read about last Tuesday. The client renders those cells
 * as past instead, which is both true and self-explanatory.
 */
export async function loadAvailability(
  input: AvailabilityQuery,
): Promise<ActionResult<AvailabilityPayload>> {
  const lang = await getLang();
  const raw = loose(input);

  const slug = parseSlug(raw.slug);
  const serviceId = parseUuid(raw.serviceId);
  const range = parseDateRange(raw.from, raw.to);
  if (!slug || !serviceId || !range) return invalidRequestError(lang);

  const gate = availabilityLimiter.check(`availability:${clientAddress(await headers())}`);
  if (!gate.allowed) return rateLimitedError(lang, gate.retryAfterMs);

  const business = await findBusinessBySlug(slug);
  if (!business) return notFoundError(lang);

  const now = new Date();
  const today = instantToDateKey(now, business.timezone);
  const horizon = addDays(today, business.maxAdvanceDays);

  const from = range.from < today ? today : range.from;
  if (from > range.to) return { ok: true, days: [], today, horizon };

  try {
    const days = await runWithTenant(business.id, async () => {
      const service = await getService(serviceId);
      // RLS makes another business's service invisible here, so this covers both "no
      // such service" and "not yours" without disclosing which.
      if (!service || !service.active) return null;

      return getAvailability({
        businessId: business.id,
        serviceId,
        from,
        to: range.to,
        now,
      });
    });

    if (days === null) return invalidRequestError(lang);

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
    console.error('loadAvailability failed', err);
    return unexpectedError(lang);
  }
}

/**
 * Create a booking.
 *
 * The phone number is normalised here as well as inside `bookPublicly`, because the
 * per-phone rate limit needs a stable key *before* any write is attempted — limiting on
 * the raw text would let `050-1234567`, `050 1234567` and `+972501234567` count as three
 * different people.
 */
export async function submitBooking(
  input: BookingSubmission,
): Promise<ActionResult<{ confirmation: ConfirmationDto }>> {
  const lang = await getLang();
  const raw = loose(input);

  const slug = parseSlug(raw.slug);
  const serviceId = parseUuid(raw.serviceId);
  const startsAt = parseInstant(raw.startsAt);
  if (!slug || !serviceId || !startsAt) return invalidRequestError(lang);

  const name = parseName(raw.name);
  if (!name) {
    const tooLong = typeof raw.name === 'string' && raw.name.trim().length > MAX_NAME_LENGTH;
    return fieldError(
      lang,
      'name',
      tooLong ? 'booking.details.nameTooLong' : 'booking.details.nameRequired',
    );
  }

  const note = parseNote(raw.note);
  if (!note.ok) return fieldError(lang, 'note', 'booking.details.noteTooLong');

  const phoneInput = parsePhoneInput(raw.phone);
  if (!phoneInput) return fieldError(lang, 'phone', 'booking.details.phoneInvalid');

  const ipGate = bookingIpLimiter.check(`book:${clientAddress(await headers())}`);
  if (!ipGate.allowed) return rateLimitedError(lang, ipGate.retryAfterMs);

  const business = await findBusinessBySlug(slug);
  if (!business) return notFoundError(lang);

  let phone: string;
  try {
    phone = normalisePhone(phoneInput, business.defaultCallingCode ?? '');
  } catch (err) {
    if (err instanceof InvalidPhoneError) {
      // When the business has no default calling code, a bare national number simply
      // cannot be resolved — say *that*, rather than implying the number is wrong.
      const looksInternational = /^\s*(\+|00)/.test(phoneInput);
      const key =
        !business.defaultCallingCode && !looksInternational
          ? 'booking.details.phoneNeedsCountry'
          : 'booking.details.phoneInvalid';
      return fieldError(lang, 'phone', key);
    }
    throw err;
  }

  const phoneGate = bookingPhoneLimiter.check(`book-phone:${phone}`);
  if (!phoneGate.allowed) return rateLimitedError(lang, phoneGate.retryAfterMs);

  // Whether an address may be collected at all is the BUSINESS's setting, re-read here
  // rather than inferred from the payload. This action is a POST endpoint like any
  // other, so an address arriving for a business that never asked its customers for one
  // is discarded rather than trusted — collecting personal data the owner did not opt
  // into is not something a crafted request gets to do.
  // The flag rides on the business we already resolved from the slug server-side,
  // so a Server Action still never takes the client's word for what is collected.
  const asksEmail = business.askCustomerEmail;
  const email = parseEmail(asksEmail ? raw.email : undefined);
  if (!email.ok) return fieldError(lang, 'email', 'booking.details.emailInvalid');

  try {
    const result = await runWithTenant(business.id, async () => {
      const service = await getService(serviceId);
      if (!service || !service.active) return null;

      const booked = await bookPublicly({
        businessId: business.id,
        serviceId,
        startsAt,
        // Undefined unless this business asked for one — parseEmail was given undefined
        // otherwise, so a payload carrying an address for a business that does not
        // collect them cannot smuggle it in.
        customerEmail: email.email,
        customerName: name,
        customerPhone: phone,
        note: note.note,
      });

      return { booked, service };
    });

    if (result === null) return invalidRequestError(lang);

    const { booked, service } = result;
    const { booking, manageToken } = booked;

    const confirmation: ConfirmationDto = {
      status: booking.status,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      serviceName: pickName(lang, service.name, service.nameHe),
      durationMin: Math.round(
        (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
      ),
      priceMinor: booking.priceMinor,
      customerName: name,
      customerPhone: phone,
      managePath: `/manage/${manageToken}`,
      icsPath: `/api/public/ics/${manageToken}`,
    };

    return { ok: true, confirmation };
  } catch (err) {
    // Verbatim, and nothing more: never reveal that a customer is blocked.
    if (err instanceof CustomerBlockedError) return blockedError(err.message);
    if (err instanceof SlotNotAvailableError) return slotTakenError(lang);
    if (err instanceof BookingConflictError) return slotTakenError(lang);
    if (err instanceof InvalidPhoneError) {
      return fieldError(lang, 'phone', 'booking.details.phoneInvalid');
    }

    console.error('submitBooking failed', err);
    return unexpectedError(lang);
  }
}
