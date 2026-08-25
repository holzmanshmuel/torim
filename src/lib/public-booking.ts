/**
 * Booking from the public page.
 *
 * This is an unauthenticated write surface — a name and a phone number, no account, no
 * verification. So the rules here are mostly about what must not be possible:
 *
 *  - You cannot book a time the business does not actually offer. The requested slot is
 *    checked against generated availability, not merely against conflicts. Trusting the
 *    posted timestamp would let anyone book 03:00, a closed day, or a date beyond the
 *    booking horizon, none of which the conflict check alone would catch.
 *  - You cannot rewrite an existing customer's record. A public form that can rename a
 *    customer lets a typo — or anyone who knows the number — corrupt the owner's list.
 *  - A blocked customer is turned away without being told they are blocked.
 */
import { createBooking, type Booking } from './booking';
import { findBusinessById, type PublicBusiness } from './businesses';
import { getAvailability, getService } from './availability';
import { query } from './db';
import { normalisePhone } from './phone';
import { stripBidiControls } from './bidi';
import { instantToDateKey } from './time';

export class SlotNotAvailableError extends Error {
  constructor() {
    super('That time is not available.');
    this.name = 'SlotNotAvailableError';
  }
}

/**
 * Message is intentionally uninformative. A blocked customer who is told they are
 * blocked simply books from a different number; one who is asked to call gets handled
 * by a human, which is what the owner actually wants.
 */
export class CustomerBlockedError extends Error {
  constructor() {
    super('This booking could not be completed online — please contact the business.');
    this.name = 'CustomerBlockedError';
  }
}

/**
 * The customer already holds as many future bookings as this business allows.
 *
 * Rate limits bound how fast someone works; this bounds how much they can hold. Without
 * it, incrementing the phone number per request gives a fresh limiter bucket every time
 * and a whole booking horizon can be filled one request at a time.
 */
export class TooManyBookingsError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super('You already have the maximum number of upcoming appointments.');
    this.name = 'TooManyBookingsError';
    this.limit = limit;
  }
}

export type PublicBookingRequest = {
  businessId: string;
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone: string;
  /**
   * Optional, and only collected when the business turned `ask_customer_email` on —
   * which it only would having configured a transport that could use one. Phone is the
   * identity here; this is a contact detail, never a key.
   */
  customerEmail?: string;
  note?: string;
  now?: Date;
};

export type PublicBookingResult = {
  booking: Booking;
  manageToken: string;
  customerId: string;
  customerCreated: boolean;
  business: PublicBusiness;
};

/**
 * Zero-width and formatting characters that are not bidi controls.
 *
 * JavaScript's `\s` does not match these and Postgres `btrim` strips spaces only, so a
 * name made entirely of them passed validation, `cleanText`, and the
 * `length(btrim(name)) > 0` CHECK — storing a customer who renders as blank everywhere
 * in the owner's admin.
 */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Trim, collapse whitespace, and strip invisible characters before anything is stored. */
function cleanText(value: string): string {
  return stripBidiControls(value).replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

/**
 * Deliberately permissive: one @, something either side, no whitespace. Anything
 * stricter rejects addresses that genuinely work, and the only real proof an address is
 * deliverable is sending to it.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvalidEmailError extends Error {
  constructor() {
    super('That does not look like an email address.');
    this.name = 'InvalidEmailError';
  }
}

function cleanEmail(value: string | undefined): string | null {
  if (value === undefined) return null;
  const email = stripBidiControls(value).trim().toLowerCase();
  if (email.length === 0) return null;
  if (email.length > 254 || !EMAIL_SHAPE.test(email)) throw new InvalidEmailError();
  return email;
}

export async function bookPublicly(
  request: PublicBookingRequest,
): Promise<PublicBookingResult> {
  const { businessId, serviceId, startsAt } = request;
  const now = request.now ?? new Date();

  const business = await findBusinessById(businessId);
  if (!business) throw new Error(`Unknown business: ${businessId}`);

  const service = await getService(serviceId);
  if (!service || !service.active) throw new SlotNotAvailableError();

  const name = cleanText(request.customerName);
  if (name.length === 0) throw new Error('A name is required.');

  // Throws InvalidPhoneError, which the caller surfaces as a field-level message.
  const phone = normalisePhone(request.customerPhone, business.defaultCallingCode ?? '');
  const email = cleanEmail(request.customerEmail);

  // The requested time must be one the business is actually offering, not merely one
  // that happens to be free.
  const dateKey = instantToDateKey(startsAt, business.timezone);
  const [day] = await getAvailability({
    businessId,
    serviceId,
    from: dateKey,
    to: dateKey,
    now,
  });
  const offered = day?.slots.some((slot) => slot.getTime() === startsAt.getTime()) ?? false;
  if (!offered) throw new SlotNotAvailableError();

  const existing = await query<{ id: string; blocked: boolean; email: string | null }>(
    'SELECT id, blocked, email FROM torim.customers WHERE phone_e164 = $1',
    [phone],
  );

  let customerId: string;
  let customerCreated = false;

  if (existing[0]) {
    if (existing[0].blocked) throw new CustomerBlockedError();
    customerId = existing[0].id;

    // Deliberately no UPDATE of anything on an existing customer — not the name, and not
    // the email either.
    //
    // An earlier version filled an empty email "because a blank is not a replacement".
    // That blank is exactly what an attacker wants: a customer the owner created by hand
    // has no address, so one booking with the victim's phone and the attacker's email
    // redirects every future confirmation and reminder — each carrying a capability URL
    // that cancels and moves her real appointments. A returning customer who wants an
    // address on file tells the owner.
  } else {
    const created = await query<{ id: string }>(
      'INSERT INTO torim.customers (name, phone_e164, email) VALUES ($1, $2, $3) RETURNING id',
      [name, phone, email],
    );
    customerId = created[0]!.id;
    customerCreated = true;
  }

  // The owner's screening toggle is what stands in for phone verification in v1: an
  // unknown number's first booking waits for her to confirm it.
  // How much one customer may hold at once. Counted after the customer is resolved, so
  // it applies to the person rather than to the request.
  if (!customerCreated) {
    const held = await query<{ count: string }>(
      `SELECT count(*) AS count FROM torim.bookings
        WHERE customer_id = $1 AND starts_at > $2 AND status IN ('pending', 'confirmed')`,
      [customerId, now],
    );
    if (Number(held[0]?.count ?? 0) >= business.maxFutureBookingsPerCustomer) {
      throw new TooManyBookingsError(business.maxFutureBookingsPerCustomer);
    }
  }

  const status = business.confirmNewCustomers && customerCreated ? 'pending' : 'confirmed';

  const booking = await createBooking({
    businessId,
    customerId,
    serviceId,
    startsAt,
    source: 'customer',
    note: request.note ? cleanText(request.note) : undefined,
    status,
  });

  return { booking, manageToken: booking.manageToken, customerId, customerCreated, business };
}
