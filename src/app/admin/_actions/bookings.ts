'use server';

/**
 * Everything the owner does to an appointment.
 *
 * Two rules run through this file and neither is negotiable:
 *
 *  1. **Never silently overlap.** `createBooking`/`rescheduleBooking` are only ever
 *     called with `allowOverlap: true` when the caller has already been shown the exact
 *     appointment it clashes with and chosen to go ahead. On the way back the write
 *     reports `overlapped`, and this file looks up *what* it overlapped so the
 *     confirmation names it rather than saying "something". The predecessor's admin
 *     move path had no conflict check at all and double-booked in silence — which is
 *     why `rescheduleBookingAction` runs the identical clash flow as creation.
 *
 *  2. **Any time is bookable.** A booking taken over the phone may be outside opening
 *     hours, on a closed day, or in ten minutes' time. Nothing here consults
 *     availability: that is the customer-facing rule, and applying it to the owner is
 *     precisely how the predecessor made her unable to enter her own bookings.
 */
import { refresh } from 'next/cache';
import {
  getBookingForAdmin,
  markAllSeen,
  markBookingSeen,
} from '@/lib/admin-bookings';
import {
  BookingConflictError,
  cancelBooking,
  createBooking,
  markNoShow,
  rescheduleBooking,
} from '@/lib/booking';
import { getService } from '@/lib/availability';
import { findOrCreateCustomer, getCustomer, searchCustomers } from '@/lib/customers';
import { localToInstant } from '@/lib/time';
import {
  adminAction,
  clashError,
  fail,
  succeed,
  type AdminActionContext,
} from '../action-helpers';
import { confirmBooking, findOverlappingBooking, setBookingNote } from '../data';
import { clockRange, whenLabel } from '../format';
import type {
  ActionResult,
  BookingSaved,
  ClashInfo,
  CustomerOption,
  MoveBookingInput,
  NewBookingInput,
} from '../types';
import { buildCustomerOption } from '../view';
import { isDateKey, optionalText, parseHhMm, requiredText } from '../validation';

/** Describe an existing booking well enough to name it in a warning. */
async function describeClash(
  bookingId: string,
  context: AdminActionContext,
): Promise<ClashInfo | null> {
  const other = await getBookingForAdmin(bookingId);
  if (!other) return null;
  return {
    bookingId: other.id,
    when: clockRange(other.startsAt, other.endsAt, context.business.timezone),
    customerName: other.customer.name,
    serviceName: other.service.name,
  };
}

/**
 * A local date and time to an absolute instant, in the business's timezone.
 *
 * `localToInstant` refuses a wall-clock time that does not exist — the hour skipped at a
 * spring-forward transition — rather than sliding it an hour. That refusal has to reach
 * the owner as a field message, not a 500.
 */
function toInstant(
  date: string,
  time: string,
  timezone: string,
): { ok: true; value: Date } | { ok: false; code: string; field: string } {
  if (!date) return { ok: false, code: 'date_required', field: 'date' };
  if (!isDateKey(date)) return { ok: false, code: 'datetime_invalid', field: 'date' };
  if (!time) return { ok: false, code: 'time_required', field: 'time' };

  const minutes = parseHhMm(time);
  if (minutes === null || minutes > 1439) {
    return { ok: false, code: 'time_required', field: 'time' };
  }

  try {
    return { ok: true, value: localToInstant(date, minutes, timezone) };
  } catch {
    return { ok: false, code: 'datetime_invalid', field: 'time' };
  }
}

/** Confirmation copy for a write that knowingly sat on top of something. */
async function describeOverlap(
  bookingId: string,
  context: AdminActionContext,
): Promise<ClashInfo | null> {
  const otherId = await findOverlappingBooking(bookingId);
  return otherId ? describeClash(otherId, context) : null;
}

// ---------------------------------------------------------------------------
// Customer typeahead
// ---------------------------------------------------------------------------

/**
 * Typeahead for the manual-booking form. Tenant-scoped like everything else, so it can
 * only ever offer this business's own customers.
 */
export async function searchCustomersAction(term: string): Promise<ActionResult<CustomerOption[]>> {
  return adminAction('manage_customers', 'new.error.', async () => {
    const matches = await searchCustomers(term, 12);
    return succeed(matches.map(buildCustomerOption));
  });
}

// ---------------------------------------------------------------------------
// Creating a booking by hand
// ---------------------------------------------------------------------------

export async function createBookingAction(
  input: NewBookingInput,
): Promise<ActionResult<BookingSaved>> {
  const result = await adminAction<BookingSaved>('manage_bookings', 'new.error.', async (context) => {
    const { business } = context;

    if (!input.serviceId) return fail(context, 'service_required', 'serviceId');

    const service = await getService(input.serviceId);
    if (!service) return fail(context, 'service_required', 'serviceId');
    // createBooking refuses a retired service with a bare Error; catch it here so the
    // owner gets a field message pointing at the select she can actually fix.
    if (!service.active) return fail(context, 'service_retired', 'serviceId');

    const when = toInstant(input.date, input.time, business.timezone);
    if (!when.ok) return fail(context, when.code, when.field);

    // Resolve the customer: an existing one by id (RLS makes another tenant's id a
    // miss), or a new one created through the same normalising path the public form
    // uses, so one person cannot become two records.
    let customerId: string;
    let customerName: string;

    if (input.customerId) {
      const customer = await getCustomer(input.customerId);
      if (!customer) return fail(context, 'customer_required', 'customerId');
      customerId = customer.id;
      customerName = customer.name;
    } else if (input.newCustomer) {
      const name = requiredText(input.newCustomer.name, 'name', 'name_required', 120);
      if (!name.ok) return fail(context, name.code, name.field);
      if (input.newCustomer.phone.trim().length === 0) {
        return fail(context, 'phone_required', 'phone');
      }
      // InvalidPhoneError is caught centrally and becomes 'phone_invalid' on the phone
      // field — see action-helpers.
      const customer = await findOrCreateCustomer({
        name: name.value,
        phone: input.newCustomer.phone,
        callingCode: business.defaultCallingCode,
      });
      customerId = customer.id;
      customerName = customer.name;
    } else {
      return fail(context, 'customer_required', 'customerId');
    }

    const note = optionalText(input.note);

    try {
      const booking = await createBooking({
        businessId: business.id,
        customerId,
        serviceId: input.serviceId,
        startsAt: when.value,
        source: 'admin',
        note: note ?? undefined,
        // Never defaulted, never inferred: only the owner's explicit second tap.
        allowOverlap: input.allowOverlap === true,
      });

      return succeed({
        bookingId: booking.id,
        when: whenLabel(booking.startsAt, context.lang, business.timezone, context.t),
        customerName,
        overlapped: booking.overlapped,
        overlappedWith: booking.overlapped ? await describeOverlap(booking.id, context) : null,
      });
    } catch (err) {
      if (err instanceof BookingConflictError) {
        const clash = await describeClash(err.conflictingBookingId, context);
        if (clash) return clashError(context, clash);
      }
      throw err;
    }
  });

  if (result.ok) refresh();
  return result;
}

// ---------------------------------------------------------------------------
// Moving a booking
// ---------------------------------------------------------------------------

export async function moveBookingAction(
  input: MoveBookingInput,
): Promise<ActionResult<BookingSaved>> {
  const result = await adminAction<BookingSaved>('manage_bookings', 'bk.error.', async (context) => {
    const existing = await getBookingForAdmin(input.bookingId);
    if (!existing) return fail(context, 'not_found');

    const when = toInstant(input.date, input.time, context.business.timezone);
    if (!when.ok) return fail(context, when.code, when.field);

    try {
      const booking = await rescheduleBooking({
        bookingId: input.bookingId,
        startsAt: when.value,
        by: 'admin',
        allowOverlap: input.allowOverlap === true,
      });

      return succeed({
        bookingId: booking.id,
        when: whenLabel(
          booking.startsAt,
          context.lang,
          context.business.timezone,
          context.t,
        ),
        customerName: existing.customer.name,
        overlapped: booking.overlapped,
        overlappedWith: booking.overlapped ? await describeOverlap(booking.id, context) : null,
      });
    } catch (err) {
      if (err instanceof BookingConflictError) {
        const clash = await describeClash(err.conflictingBookingId, context);
        if (clash) return clashError(context, clash);
      }
      throw err;
    }
  });

  if (result.ok) refresh();
  return result;
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

export async function cancelBookingAction(bookingId: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_bookings', 'bk.error.', async () => {
    // `by: 'admin'` deliberately bypasses the cancellation window: the owner has to be
    // able to clear her own day at any notice, including a walk-out five minutes before.
    await cancelBooking({ bookingId, by: 'admin' });
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function markNoShowAction(bookingId: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_bookings', 'bk.error.', async () => {
    // Refuses for an appointment that has not finished — a stray tap on tomorrow's
    // booking would otherwise free the slot with no warning anywhere.
    await markNoShow({ bookingId });
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function confirmBookingAction(bookingId: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_bookings', 'bk.error.', async (context) => {
    const changed = await confirmBooking(bookingId);
    if (!changed) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function saveBookingNoteAction(
  bookingId: string,
  note: string,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_bookings', 'bk.error.', async (context) => {
    const changed = await setBookingNote(bookingId, optionalText(note));
    if (!changed) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

// ---------------------------------------------------------------------------
// The unseen-changes badge
// ---------------------------------------------------------------------------

/**
 * Acknowledge one customer change.
 *
 * Not a boolean flag being flipped: `owner_seen_at` is stamped, and "needs attention"
 * stays a comparison against `last_customer_change_at`. A later change by the same
 * customer therefore reopens it by itself, which a cleared boolean never would.
 */
export async function markSeenAction(bookingId: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_bookings', 'chg.error.', async () => {
    await markBookingSeen(bookingId);
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function markAllSeenAction(): Promise<ActionResult<number>> {
  const result = await adminAction<number>('manage_bookings', 'chg.error.', async () => {
    const cleared = await markAllSeen();
    return succeed(cleared);
  });

  if (result.ok) refresh();
  return result;
}
