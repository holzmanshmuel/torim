/**
 * Managing a booking from its link.
 *
 * The link carries a per-booking capability token — 256 bits, minted by the database.
 * Knowing it is the whole credential, which is a deliberate improvement on the
 * predecessor project, where a phone number alone let anyone view, move or cancel a
 * customer's appointments. At single-salon scale that was an accepted trust trade-off;
 * across many tenants it is not.
 *
 * Resolving a token necessarily happens before any tenant context exists, so it goes
 * through the narrow SECURITY DEFINER function that returns only the business id (see
 * migration 004). Everything after that is read under normal RLS.
 */
import {
  cancelBooking,
  rescheduleBooking,
  type Actor,
  type Booking,
} from './booking';
import { getAvailability, getService, type ServiceSummary } from './availability';
import { findBusinessById, type PublicBusiness } from './businesses';
import { query, systemQueryOne } from './db';
import { SlotNotAvailableError } from './public-booking';
import { runWithTenant } from './tenant';
import { instantToDateKey } from './time';

/** Tokens are 64 lowercase hex characters. Anything else cannot be one. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

export type ManagedBooking = {
  booking: Booking;
  business: PublicBusiness;
  service: ServiceSummary;
  customer: { id: string; name: string; phone: string };
};

type BookingRow = {
  id: string;
  customer_id: string;
  service_id: string;
  starts_at: Date;
  ends_at: Date;
  status: Booking['status'];
  price_minor: number;
  manage_token: string;
  cancelled_at: Date | null;
  cancelled_by: Actor | null;
};

async function businessForToken(token: string): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const row = await systemQueryOne<{ business_for_manage_token: string | null }>(
    'SELECT torim.business_for_manage_token($1)',
    [token],
  );
  return row?.business_for_manage_token ?? null;
}

/** Null for anything unresolvable — a bad token discloses nothing beyond its own failure. */
export async function findBookingByManageToken(token: string): Promise<ManagedBooking | null> {
  const businessId = await businessForToken(token);
  if (!businessId) return null;

  const business = await findBusinessById(businessId);
  if (!business) return null;

  return runWithTenant(businessId, async () => {
    const rows = await query<BookingRow>(
      `SELECT id, customer_id, service_id, starts_at, ends_at, status, price_minor,
              manage_token, cancelled_at, cancelled_by
         FROM torim.bookings WHERE manage_token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) return null;

    const service = await getService(row.service_id);
    if (!service) return null;

    const customers = await query<{ id: string; name: string; phone_e164: string }>(
      'SELECT id, name, phone_e164 FROM torim.customers WHERE id = $1',
      [row.customer_id],
    );
    const customer = customers[0];
    if (!customer) return null;

    return {
      booking: {
        id: row.id,
        customerId: row.customer_id,
        serviceId: row.service_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        priceMinor: row.price_minor,
        manageToken: row.manage_token,
        cancelledAt: row.cancelled_at,
        cancelledBy: row.cancelled_by,
        overlapped: false,
      },
      business,
      service,
      customer: { id: customer.id, name: customer.name, phone: customer.phone_e164 },
    };
  });
}

export async function cancelByManageToken(args: { token: string; now?: Date }): Promise<Booking> {
  const found = await findBookingByManageToken(args.token);
  if (!found) throw new Error('Booking not found.');

  return runWithTenant(found.business.id, () =>
    // 'customer', so the cancellation-window rule applies and the owner's
    // unseen-changes badge lights up.
    cancelBooking({ bookingId: found.booking.id, by: 'customer', now: args.now }),
  );
}

export async function rescheduleByManageToken(args: {
  token: string;
  startsAt: Date;
  now?: Date;
}): Promise<Booking> {
  const found = await findBookingByManageToken(args.token);
  if (!found) throw new Error('Booking not found.');

  const now = args.now ?? new Date();
  const { business, service, booking } = found;

  // Same rule as booking: the new time must be one the business actually offers.
  const dateKey = instantToDateKey(args.startsAt, business.timezone);
  const [day] = await runWithTenant(business.id, () =>
    getAvailability({
      businessId: business.id,
      serviceId: service.id,
      from: dateKey,
      to: dateKey,
      now,
      // The booking being moved must not count against its own availability, or a
      // customer can never shift by one slot.
      excludeBookingId: booking.id,
    }),
  );
  const offered = day?.slots.some((slot) => slot.getTime() === args.startsAt.getTime()) ?? false;
  if (!offered) throw new SlotNotAvailableError();

  return runWithTenant(business.id, () =>
    rescheduleBooking({ bookingId: booking.id, startsAt: args.startsAt, by: 'customer' }),
  );
}
