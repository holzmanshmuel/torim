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

export type PublicBookingRequest = {
  businessId: string;
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone: string;
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

/** Trim, collapse whitespace, and strip bidi overrides before anything is stored. */
function cleanText(value: string): string {
  return stripBidiControls(value).replace(/\s+/g, ' ').trim();
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

  const existing = await query<{ id: string; blocked: boolean }>(
    'SELECT id, blocked FROM torim.customers WHERE phone_e164 = $1',
    [phone],
  );

  let customerId: string;
  let customerCreated = false;

  if (existing[0]) {
    if (existing[0].blocked) throw new CustomerBlockedError();
    customerId = existing[0].id;
    // Deliberately no UPDATE of the name. The owner's record wins over form input.
  } else {
    const created = await query<{ id: string }>(
      'INSERT INTO torim.customers (name, phone_e164) VALUES ($1, $2) RETURNING id',
      [name, phone],
    );
    customerId = created[0]!.id;
    customerCreated = true;
  }

  // The owner's screening toggle is what stands in for phone verification in v1: an
  // unknown number's first booking waits for her to confirm it.
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
