/**
 * Booking writes.
 *
 * Race safety comes from a transaction-scoped advisory lock keyed on (business, local
 * day), taken before the conflict check and released when the transaction ends. Two
 * customers racing for the last slot therefore serialise: the second one's check runs
 * after the first one's insert, and sees it.
 *
 * There is deliberately no exclusion constraint in the schema forbidding overlap. An
 * owner must be able to force one on purpose, and a constraint cannot be consciously
 * overridden — only removed. What `allowOverlap` must never do is skip the *check*: it
 * skips the rejection, and the caller is still told an overlap happened.
 */
import type { PoolClient } from 'pg';
import { withTransaction } from './db';
import { instantToDateKey } from './time';

export class BookingConflictError extends Error {
  readonly conflictingBookingId: string;

  constructor(conflictingBookingId: string) {
    super('That time is no longer available.');
    this.name = 'BookingConflictError';
    this.conflictingBookingId = conflictingBookingId;
  }
}

export class CancellationTooLateError extends Error {
  readonly startsAt: Date;
  readonly windowMinutes: number;

  constructor(startsAt: Date, windowMinutes: number) {
    super('It is too late to cancel this booking online.');
    this.name = 'CancellationTooLateError';
    this.startsAt = startsAt;
    this.windowMinutes = windowMinutes;
  }
}

export class BookingNotFinishedError extends Error {
  readonly endsAt: Date;

  constructor(endsAt: Date) {
    super('That appointment has not happened yet.');
    this.name = 'BookingNotFinishedError';
    this.endsAt = endsAt;
  }
}

export class BookingNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = 'BookingNotFoundError';
  }
}

export type Actor = 'customer' | 'admin';

export type Booking = {
  id: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'pending' | 'confirmed' | 'cancelled' | 'no_show';
  priceMinor: number;
  manageToken: string;
  cancelledAt: Date | null;
  cancelledBy: Actor | null;
  /** True when this write knowingly overlapped an existing booking. */
  overlapped: boolean;
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

function toBooking(row: BookingRow, overlapped: boolean): Booking {
  return {
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
    overlapped,
  };
}

const RETURNING = `id, customer_id, service_id, starts_at, ends_at, status,
                   price_minor, manage_token, cancelled_at, cancelled_by`;

async function businessTimezone(client: PoolClient, businessId: string): Promise<string> {
  const { rows } = await client.query<{ timezone: string }>(
    'SELECT timezone FROM torim.businesses WHERE id = $1',
    [businessId],
  );
  const timezone = rows[0]?.timezone;
  if (!timezone) throw new Error(`Unknown business: ${businessId}`);
  return timezone;
}

/**
 * Serialise every write touching this business on this local day.
 *
 * Transaction-scoped, so it is released on COMMIT or ROLLBACK with no unlock call to
 * forget. Keyed on the local day rather than the business so two owners' busy Saturdays
 * do not queue behind each other.
 */
async function lockDay(client: PoolClient, businessId: string, day: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${businessId}:${day}`,
  ]);
}

/**
 * Find a booking whose occupied interval overlaps the candidate one.
 * `excludeBookingId` keeps a booking from blocking its own reschedule.
 */
async function findConflict(
  client: PoolClient,
  blocksFrom: Date,
  blocksUntil: Date,
  excludeBookingId?: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM torim.bookings
      WHERE status IN ('pending', 'confirmed')
        AND blocks_from  < $2
        AND blocks_until > $1
        AND ($3::uuid IS NULL OR id <> $3::uuid)
      LIMIT 1`,
    [blocksFrom, blocksUntil, excludeBookingId ?? null],
  );
  return rows[0]?.id ?? null;
}

export type CreateBookingArgs = {
  businessId: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  source: Actor;
  note?: string;
  status?: 'pending' | 'confirmed';
  /** Owner override: book anyway, and report that it overlapped. */
  allowOverlap?: boolean;
};

export async function createBooking(args: CreateBookingArgs): Promise<Booking> {
  const { businessId, customerId, serviceId, startsAt, source } = args;

  return withTransaction(async (client) => {
    const timezone = await businessTimezone(client, businessId);
    await lockDay(client, businessId, instantToDateKey(startsAt, timezone));

    const { rows: services } = await client.query<{
      duration_min: number;
      price_minor: number;
      buffer_before_min: number;
      buffer_after_min: number;
      active: boolean;
    }>(
      `SELECT duration_min, price_minor, buffer_before_min, buffer_after_min, active
         FROM torim.services WHERE id = $1`,
      [serviceId],
    );
    const service = services[0];
    if (!service) throw new Error(`Unknown service: ${serviceId}`);
    if (!service.active) throw new Error(`Service is not bookable: ${serviceId}`);

    const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000);
    const blocksFrom = new Date(startsAt.getTime() - service.buffer_before_min * 60_000);
    const blocksUntil = new Date(endsAt.getTime() + service.buffer_after_min * 60_000);

    const conflictId = await findConflict(client, blocksFrom, blocksUntil);
    if (conflictId && !args.allowOverlap) throw new BookingConflictError(conflictId);

    // A customer-initiated write is something the owner has not seen yet; her own
    // entries need no such flag.
    //
    // Stamped with SQL now() rather than a JavaScript Date so every timestamp in this
    // table comes from one clock. now() is the transaction start time, so a JS Date
    // taken here would sit slightly *after* it — and the unseen-changes badge compares
    // this column against owner_seen_at, which is also now(). Mixing the two made a
    // booking stay flagged immediately after the owner cleared it.
    const { rows } = await client.query<BookingRow>(
      `INSERT INTO torim.bookings
         (customer_id, service_id, starts_at, ends_at,
          buffer_before_min, buffer_after_min, status, price_minor, note, source,
          last_customer_change_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN $10 = 'customer' THEN now() ELSE NULL END)
       RETURNING ${RETURNING}`,
      [
        customerId,
        serviceId,
        startsAt,
        endsAt,
        service.buffer_before_min,
        service.buffer_after_min,
        args.status ?? 'confirmed',
        service.price_minor,
        args.note ?? null,
        source,
      ],
    );

    return toBooking(rows[0]!, conflictId !== null);
  });
}

export type RescheduleArgs = {
  bookingId: string;
  startsAt: Date;
  by: Actor;
  allowOverlap?: boolean;
};

export async function rescheduleBooking(args: RescheduleArgs): Promise<Booking> {
  const { bookingId, startsAt, by } = args;

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query<{
      business_id: string;
      starts_at: Date;
      ends_at: Date;
      buffer_before_min: number;
      buffer_after_min: number;
    }>(
      `SELECT business_id, starts_at, ends_at, buffer_before_min, buffer_after_min
         FROM torim.bookings WHERE id = $1`,
      [bookingId],
    );
    const booking = existing[0];
    if (!booking) throw new BookingNotFoundError(bookingId);

    const timezone = await businessTimezone(client, booking.business_id);
    await lockDay(client, booking.business_id, instantToDateKey(startsAt, timezone));

    const durationMs = booking.ends_at.getTime() - booking.starts_at.getTime();
    const endsAt = new Date(startsAt.getTime() + durationMs);
    const blocksFrom = new Date(startsAt.getTime() - booking.buffer_before_min * 60_000);
    const blocksUntil = new Date(endsAt.getTime() + booking.buffer_after_min * 60_000);

    // Excluding this booking is what lets a customer shift by fifteen minutes instead of
    // clashing with itself and being told the slot is taken.
    const conflictId = await findConflict(client, blocksFrom, blocksUntil, bookingId);
    if (conflictId && !args.allowOverlap) throw new BookingConflictError(conflictId);

    const { rows } = await client.query<BookingRow>(
      `UPDATE torim.bookings
          SET starts_at = $2,
              ends_at   = $3,
              updated_at = now(),
              last_customer_change_at =
                CASE WHEN $4 = 'customer' THEN now() ELSE last_customer_change_at END,
              owner_seen_at =
                CASE WHEN $4 = 'customer' THEN NULL ELSE owner_seen_at END
        WHERE id = $1
        RETURNING ${RETURNING}`,
      [bookingId, startsAt, endsAt, by],
    );

    return toBooking(rows[0]!, conflictId !== null);
  });
}

export type CancelArgs = {
  bookingId: string;
  by: Actor;
  /** Injected so the window rule is testable without waiting for a real clock. */
  now?: Date;
};

export async function cancelBooking(args: CancelArgs): Promise<Booking> {
  const { bookingId, by } = args;
  const now = args.now ?? new Date();

  return withTransaction(async (client) => {
    // The window restrains customers, never the owner: she has to be able to clear her
    // own day at any notice, including for a walk-out five minutes beforehand.
    if (by === 'customer') {
      const { rows: found } = await client.query<{
        starts_at: Date;
        cancellation_window_min: number;
      }>(
        `SELECT b.starts_at, s.cancellation_window_min
           FROM torim.bookings b
           JOIN torim.businesses s ON s.id = b.business_id
          WHERE b.id = $1`,
        [bookingId],
      );
      const booking = found[0];
      if (!booking) throw new BookingNotFoundError(bookingId);

      const noticeMs = booking.starts_at.getTime() - now.getTime();
      if (noticeMs < booking.cancellation_window_min * 60_000) {
        throw new CancellationTooLateError(booking.starts_at, booking.cancellation_window_min);
      }
    }

    const { rows } = await client.query<BookingRow>(
      `UPDATE torim.bookings
          SET status = 'cancelled',
              cancelled_at = now(),
              cancelled_by = $2,
              updated_at = now(),
              last_customer_change_at =
                CASE WHEN $2 = 'customer' THEN now() ELSE last_customer_change_at END,
              owner_seen_at =
                CASE WHEN $2 = 'customer' THEN NULL ELSE owner_seen_at END
        WHERE id = $1
        RETURNING ${RETURNING}`,
      [bookingId, by],
    );
    if (rows.length === 0) throw new BookingNotFoundError(bookingId);
    return toBooking(rows[0]!, false);
  });
}

export type MarkNoShowArgs = {
  bookingId: string;
  now?: Date;
};

/**
 * Record that a customer did not turn up.
 *
 * Refuses for an appointment that has not finished yet. A no-show frees the slot, so one
 * stray tap on tomorrow's booking would otherwise quietly hand it to someone else — with
 * no warning and no cue on the calendar, which is exactly how it went wrong before.
 */
export async function markNoShow(args: MarkNoShowArgs): Promise<Booking> {
  const { bookingId } = args;
  const now = args.now ?? new Date();

  return withTransaction(async (client) => {
    const { rows: found } = await client.query<{ ends_at: Date }>(
      'SELECT ends_at FROM torim.bookings WHERE id = $1',
      [bookingId],
    );
    const booking = found[0];
    if (!booking) throw new BookingNotFoundError(bookingId);

    if (booking.ends_at.getTime() > now.getTime()) {
      throw new BookingNotFinishedError(booking.ends_at);
    }

    const { rows } = await client.query<BookingRow>(
      `UPDATE torim.bookings
          SET status = 'no_show', updated_at = now()
        WHERE id = $1
        RETURNING ${RETURNING}`,
      [bookingId],
    );
    return toBooking(rows[0]!, false);
  });
}
