/**
 * Booking writes, against a real Postgres.
 *
 * The conflict rules live here rather than in a schema constraint on purpose: an owner
 * must be able to force an overlap deliberately (squeezing in a regular, double-booking
 * a quick job), so the guard has to be one the caller can consciously override. What it
 * must never be is *silently* skipped on some code path — hence the same check on create
 * and on reschedule, and a test for each.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BookingConflictError,
  BookingNotFinishedError,
  CancellationTooLateError,
  cancelBooking,
  createBooking,
  markNoShow,
  rescheduleBooking,
} from './booking';
import { query, systemQueryOne } from './db';
import { runWithTenant } from './tenant';
import { startTestTransaction, type TestDatabase } from './test-db';
import { localToInstant } from './time';

const TZ = 'Asia/Jerusalem';
const DAY = '2026-06-15';
const at = (minutes: number, day = DAY) => localToInstant(day, minutes, TZ);

let db: TestDatabase;
let businessId: string;
let serviceId: string;
let customerId: string;
let otherCustomerId: string;

beforeAll(async () => {
  db = await startTestTransaction();

  const business = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ('booking-test', 'Booking Test', $1, 'ILS') RETURNING id`,
    [TZ],
  );
  businessId = business!.id;

  await runWithTenant(businessId, async () => {
    const service = await query<{ id: string }>(
      `INSERT INTO torim.services (name, duration_min, price_minor, buffer_before_min, buffer_after_min)
       VALUES ('Cut', 60, 12000, 0, 0) RETURNING id`,
    );
    serviceId = service[0]!.id;

    const customers = await query<{ id: string }>(
      `INSERT INTO torim.customers (name, phone_e164) VALUES ('Ada', '+15550100001'), ('Grace', '+15550100002')
       RETURNING id`,
    );
    customerId = customers[0]!.id;
    otherCustomerId = customers[1]!.id;
  });
});

afterAll(async () => {
  await db.rollback();
});

describe('createBooking', () => {
  it('derives the end time and snapshots the price and buffers', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60),
        source: 'customer',
      }),
    );

    expect(booking.startsAt.getTime()).toBe(at(9 * 60).getTime());
    expect(booking.endsAt.getTime()).toBe(at(10 * 60).getTime());
    expect(booking.priceMinor).toBe(12000);
    expect(booking.status).toBe('confirmed');
    expect(booking.manageToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stamps a customer booking as needing the owner’s attention', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(14 * 60),
        source: 'customer',
      }),
    );
    const rows = await runWithTenant(businessId, () =>
      query<{ last_customer_change_at: Date | null; owner_seen_at: Date | null }>(
        'SELECT last_customer_change_at, owner_seen_at FROM torim.bookings WHERE id = $1',
        [booking.id],
      ),
    );
    expect(rows[0]!.last_customer_change_at).not.toBeNull();
    expect(rows[0]!.owner_seen_at).toBeNull();
  });

  it('does not flag an owner’s own manual entry as needing attention', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(15 * 60),
        source: 'admin',
      }),
    );
    const rows = await runWithTenant(businessId, () =>
      query<{ last_customer_change_at: Date | null }>(
        'SELECT last_customer_change_at FROM torim.bookings WHERE id = $1',
        [booking.id],
      ),
    );
    expect(rows[0]!.last_customer_change_at).toBeNull();
  });

  it('refuses a booking that overlaps an existing one', async () => {
    await expect(
      runWithTenant(businessId, () =>
        createBooking({
          businessId,
          customerId: otherCustomerId,
          serviceId,
          startsAt: at(9 * 60 + 30),
          source: 'customer',
        }),
      ),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });

  it('allows two bookings to abut exactly', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: otherCustomerId,
        serviceId,
        startsAt: at(10 * 60),
        source: 'customer',
      }),
    );
    expect(booking.id).toBeTruthy();
  });

  it('lets an owner force an overlap deliberately', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: otherCustomerId,
        serviceId,
        startsAt: at(9 * 60 + 30),
        source: 'admin',
        allowOverlap: true,
      }),
    );
    expect(booking.id).toBeTruthy();
    // The override must not hide the fact that it overlapped — the owner is told.
    expect(booking.overlapped).toBe(true);
  });

  it('reports no overlap when the forced booking did not actually clash', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(12 * 60),
        source: 'admin',
        allowOverlap: true,
      }),
    );
    expect(booking.overlapped).toBe(false);
  });

  it('ignores cancelled bookings when looking for a clash', async () => {
    const doomed = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(19 * 60),
        source: 'customer',
      }),
    );
    await runWithTenant(businessId, () =>
      cancelBooking({ bookingId: doomed.id, by: 'customer', now: at(9 * 60, '2026-06-14') }),
    );

    const replacement = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: otherCustomerId,
        serviceId,
        startsAt: at(19 * 60),
        source: 'customer',
      }),
    );
    expect(replacement.id).toBeTruthy();
  });

  it('honours service buffers when appointments would not otherwise touch', async () => {
    const buffered = await runWithTenant(businessId, async () => {
      const rows = await query<{ id: string }>(
        `INSERT INTO torim.services (name, duration_min, price_minor, buffer_before_min, buffer_after_min)
         VALUES ('Colour', 60, 30000, 30, 30) RETURNING id`,
      );
      return rows[0]!.id;
    });

    await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId: buffered,
        startsAt: at(9 * 60, '2026-06-16'),
        source: 'customer',
      }),
    );

    // 10:00 does not overlap the 09:00–10:00 appointment, but its 30-minute
    // before-buffer runs back into that appointment's 30-minute after-buffer.
    await expect(
      runWithTenant(businessId, () =>
        createBooking({
          businessId,
          customerId: otherCustomerId,
          serviceId: buffered,
          startsAt: at(10 * 60, '2026-06-16'),
          source: 'customer',
        }),
      ),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });
});

describe('rescheduleBooking', () => {
  it('moves a booking to a free slot', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-17'),
        source: 'customer',
      }),
    );

    const moved = await runWithTenant(businessId, () =>
      rescheduleBooking({ bookingId: booking.id, startsAt: at(11 * 60, '2026-06-17'), by: 'customer' }),
    );
    expect(moved.startsAt.getTime()).toBe(at(11 * 60, '2026-06-17').getTime());
    expect(moved.endsAt.getTime()).toBe(at(12 * 60, '2026-06-17').getTime());
  });

  /**
   * A booking must not block its own move. Without excluding it from the conflict check,
   * shifting an appointment by fifteen minutes clashes with itself and a customer can
   * never move to an adjacent slot — which is exactly what the predecessor app did.
   */
  it('does not treat the booking being moved as its own conflict', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-18'),
        source: 'customer',
      }),
    );

    const moved = await runWithTenant(businessId, () =>
      rescheduleBooking({
        bookingId: booking.id,
        startsAt: at(9 * 60 + 30, '2026-06-18'),
        by: 'customer',
      }),
    );
    expect(moved.startsAt.getTime()).toBe(at(9 * 60 + 30, '2026-06-18').getTime());
  });

  it('still refuses a move onto a different booking', async () => {
    const [a, b] = await runWithTenant(businessId, async () => [
      await createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-19'),
        source: 'customer',
      }),
      await createBooking({
        businessId,
        customerId: otherCustomerId,
        serviceId,
        startsAt: at(14 * 60, '2026-06-19'),
        source: 'customer',
      }),
    ]);

    await expect(
      runWithTenant(businessId, () =>
        rescheduleBooking({ bookingId: a.id, startsAt: b.startsAt, by: 'customer' }),
      ),
    ).rejects.toBeInstanceOf(BookingConflictError);
  });

  it('lets an owner force a move onto an occupied slot', async () => {
    const [a, b] = await runWithTenant(businessId, async () => [
      await createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-22'),
        source: 'customer',
      }),
      await createBooking({
        businessId,
        customerId: otherCustomerId,
        serviceId,
        startsAt: at(14 * 60, '2026-06-22'),
        source: 'customer',
      }),
    ]);

    const moved = await runWithTenant(businessId, () =>
      rescheduleBooking({
        bookingId: a.id,
        startsAt: b.startsAt,
        by: 'admin',
        allowOverlap: true,
      }),
    );
    expect(moved.overlapped).toBe(true);
  });
});

describe('cancelBooking', () => {
  it('records who cancelled and when', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(16 * 60, '2026-06-23'),
        source: 'customer',
      }),
    );

    const cancelled = await runWithTenant(businessId, () =>
      cancelBooking({ bookingId: booking.id, by: 'customer', now: at(16 * 60, '2026-06-21') }),
    );

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledBy).toBe('customer');
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
  });

  it('flags a customer cancellation for the owner, and an owner’s own does not', async () => {
    const byCustomer = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-24'),
        source: 'admin',
      }),
    );
    await runWithTenant(businessId, () =>
      cancelBooking({ bookingId: byCustomer.id, by: 'customer', now: at(9 * 60, '2026-06-22') }),
    );

    const byOwner = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(11 * 60, '2026-06-24'),
        source: 'admin',
      }),
    );
    await runWithTenant(businessId, () => cancelBooking({ bookingId: byOwner.id, by: 'admin' }));

    const rows = await runWithTenant(businessId, () =>
      query<{ id: string; last_customer_change_at: Date | null }>(
        'SELECT id, last_customer_change_at FROM torim.bookings WHERE id = ANY($1)',
        [[byCustomer.id, byOwner.id]],
      ),
    );
    const flagged = new Map(rows.map((r) => [r.id, r.last_customer_change_at]));
    expect(flagged.get(byCustomer.id)).not.toBeNull();
    expect(flagged.get(byOwner.id)).toBeNull();
  });

  it('refuses to cancel a booking that is not there', async () => {
    await expect(
      runWithTenant(businessId, () =>
        cancelBooking({ bookingId: '00000000-0000-0000-0000-000000000000', by: 'admin' }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('cancellation window', () => {
  it('lets a customer cancel outside the business’s notice window', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(15 * 60, '2026-06-25'),
        source: 'customer',
      }),
    );

    const cancelled = await runWithTenant(businessId, () =>
      cancelBooking({
        bookingId: booking.id,
        by: 'customer',
        now: at(10 * 60, '2026-06-24'), // 29 hours ahead, outside the default 24h window
      }),
    );
    expect(cancelled.status).toBe('cancelled');
  });

  it('refuses a customer cancellation inside the window', async () => {
    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET cancellation_window_min = 120 WHERE id = $1', [
        businessId,
      ]),
    );

    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(15 * 60, '2026-06-26'),
        source: 'customer',
      }),
    );

    await expect(
      runWithTenant(businessId, () =>
        cancelBooking({
          bookingId: booking.id,
          by: 'customer',
          now: at(14 * 60, '2026-06-26'), // one hour ahead, inside a two-hour window
        }),
      ),
    ).rejects.toBeInstanceOf(CancellationTooLateError);
  });

  it('never blocks the owner from cancelling', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(15 * 60, '2026-06-27'),
        source: 'admin',
      }),
    );

    const cancelled = await runWithTenant(businessId, () =>
      cancelBooking({
        bookingId: booking.id,
        by: 'admin',
        now: at(14 * 60 + 55, '2026-06-27'),
      }),
    );
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('markNoShow', () => {
  it('marks a finished appointment as a no-show', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-28'),
        source: 'admin',
      }),
    );

    const marked = await runWithTenant(businessId, () =>
      markNoShow({ bookingId: booking.id, now: at(11 * 60, '2026-06-28') }),
    );
    expect(marked.status).toBe('no_show');
  });

  /**
   * One stray tap on tomorrow's appointment silently freed the slot in the predecessor
   * app — no warning, no cue on the calendar, and a customer could book over it. A
   * booking that has not happened yet cannot have been missed.
   */
  it('refuses to mark a future appointment as missed', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-29'),
        source: 'admin',
      }),
    );

    await expect(
      runWithTenant(businessId, () =>
        markNoShow({ bookingId: booking.id, now: at(8 * 60, '2026-06-29') }),
      ),
    ).rejects.toBeInstanceOf(BookingNotFinishedError);
  });

  it('still frees the slot once a no-show is recorded', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-30'),
        source: 'admin',
      }),
    );
    await runWithTenant(businessId, () =>
      markNoShow({ bookingId: booking.id, now: at(11 * 60, '2026-06-30') }),
    );

    const replacement = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: otherCustomerId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-30'),
        source: 'admin',
      }),
    );
    expect(replacement.overlapped).toBe(false);
  });
});
