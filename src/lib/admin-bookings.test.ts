/**
 * The owner's view of her own day.
 *
 * The two behaviours worth being strict about here both come from watching a real salon:
 * a day must show everything on it including appointments outside opening hours, and
 * "a customer changed something" has to be answerable from state rather than from a
 * nightly digest.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countUnseenChanges,
  listBookingsForDay,
  listBookingsForRange,
  markAllSeen,
  markBookingSeen,
} from './admin-bookings';
import { cancelBooking, createBooking } from './booking';
import { findOrCreateCustomer } from './customers';
import { query, systemQueryOne } from './db';
import { runWithTenant } from './tenant';
import { startTestTransaction, type TestDatabase } from './test-db';
import { instantToMinutes, localToInstant } from './time';

const TZ = 'Asia/Jerusalem';
const MONDAY = '2026-06-15';
const at = (minutes: number, day = MONDAY) => localToInstant(day, minutes, TZ);

let db: TestDatabase;
let businessId: string;
let serviceId: string;
let adaId: string;

beforeAll(async () => {
  db = await startTestTransaction();

  const b = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency, default_calling_code,
                                   cancellation_window_min)
     VALUES ('admin-test', 'Admin Test', $1, 'ILS', '972', 0) RETURNING id`,
    [TZ],
  );
  businessId = b!.id;

  await runWithTenant(businessId, async () => {
    const s = await query<{ id: string }>(
      `INSERT INTO torim.services (name, duration_min, price_minor, colour)
       VALUES ('Cut', 60, 12000, 'blue') RETURNING id`,
    );
    serviceId = s[0]!.id;
    await query(`INSERT INTO torim.working_hours (weekday, start_min, end_min) VALUES (1, 540, 1020)`);

    const ada = await findOrCreateCustomer({ name: 'Ada', phone: '050-111-2222', callingCode: '972' });
    adaId = ada.id;
  });
});

afterAll(async () => {
  await db.rollback();
});

describe('listBookingsForDay', () => {
  it('joins the customer and service the owner needs to see', async () => {
    await runWithTenant(businessId, () =>
      createBooking({ businessId, customerId: adaId, serviceId, startsAt: at(10 * 60), source: 'admin' }),
    );

    const day = await runWithTenant(businessId, () => listBookingsForDay({ businessId, date: MONDAY }));
    expect(day).toHaveLength(1);
    expect(day[0]!.customer.name).toBe('Ada');
    expect(day[0]!.customer.phone).toBe('+972501112222');
    expect(day[0]!.service.name).toBe('Cut');
    expect(day[0]!.service.colour).toBe('blue');
  });

  /**
   * The predecessor project's day view was hardcoded to the public booking window, so a
   * booking the owner had entered manually for 07:30 — before opening — simply did not
   * appear anywhere. She had created it herself and could not see it.
   */
  it('shows an appointment outside opening hours', async () => {
    await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(7 * 60 + 30), // opening is 09:00
        source: 'admin',
        allowOverlap: true,
      }),
    );

    const day = await runWithTenant(businessId, () => listBookingsForDay({ businessId, date: MONDAY }));
    const starts = day.map((b) => instantToMinutes(b.startsAt, TZ));
    expect(starts).toContain(7 * 60 + 30);
  });

  it('orders the day by start time', async () => {
    await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(23 * 60),
        source: 'admin',
        allowOverlap: true,
      }),
    );

    const day = await runWithTenant(businessId, () => listBookingsForDay({ businessId, date: MONDAY }));
    const starts = day.map((b) => instantToMinutes(b.startsAt, TZ));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts).toContain(23 * 60);
  });

  it('uses the business’s local day boundaries, not the server’s', async () => {
    // 00:30 local is the previous day in UTC — it must still land on this day.
    await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(30),
        source: 'admin',
        allowOverlap: true,
      }),
    );

    const day = await runWithTenant(businessId, () => listBookingsForDay({ businessId, date: MONDAY }));
    expect(day.map((b) => instantToMinutes(b.startsAt, TZ))).toContain(30);

    const dayBefore = await runWithTenant(businessId, () =>
      listBookingsForDay({ businessId, date: '2026-06-14' }),
    );
    expect(dayBefore).toHaveLength(0);
  });

  it('still lists a cancelled booking, so the owner can see what happened', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-22'),
        source: 'admin',
      }),
    );
    await runWithTenant(businessId, () => cancelBooking({ bookingId: booking.id, by: 'admin' }));

    const day = await runWithTenant(businessId, () =>
      listBookingsForDay({ businessId, date: '2026-06-22' }),
    );
    expect(day.map((b) => b.status)).toContain('cancelled');
  });
});

describe('listBookingsForRange', () => {
  it('covers a whole week in one query', async () => {
    const week = await runWithTenant(businessId, () =>
      listBookingsForRange({ businessId, from: '2026-06-15', to: '2026-06-21' }),
    );
    expect(week.length).toBeGreaterThan(0);
    expect(week.every((b) => b.startsAt >= at(0) && b.startsAt < at(0, '2026-06-22'))).toBe(true);
  });
});

describe('unseen changes', () => {
  it('counts nothing when only the owner has been making changes', async () => {
    await runWithTenant(businessId, () => markAllSeen());
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(0);
  });

  it('counts a booking the customer made', async () => {
    await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(11 * 60, '2026-06-29'),
        source: 'customer',
      }),
    );
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(1);
  });

  it('counts a booking the customer cancelled, even one the owner had entered', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(12 * 60, '2026-06-29'),
        source: 'admin',
      }),
    );
    await runWithTenant(businessId, () =>
      cancelBooking({ bookingId: booking.id, by: 'customer', now: at(9 * 60, '2026-06-28') }),
    );
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(2);
  });

  it('clears once the owner has looked at it', async () => {
    const unseen = await runWithTenant(businessId, () =>
      query<{ id: string }>(
        `SELECT id FROM torim.bookings
          WHERE last_customer_change_at IS NOT NULL
            AND (owner_seen_at IS NULL OR owner_seen_at < last_customer_change_at)
          ORDER BY last_customer_change_at LIMIT 1`,
      ),
    );
    await runWithTenant(businessId, () => markBookingSeen(unseen[0]!.id));
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(1);

    await runWithTenant(businessId, () => markAllSeen());
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(0);
  });

  /**
   * The badge is derived from timestamps rather than a boolean, so a change made after
   * the owner looked reopens it. A boolean "seen" flag would be cleared by the first
   * glance and stay cleared through everything that happened afterwards.
   */
  it('reopens when the customer changes something again after it was seen', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId: adaId,
        serviceId,
        startsAt: at(14 * 60, '2026-06-29'),
        source: 'customer',
      }),
    );
    await runWithTenant(businessId, () => markAllSeen());
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(0);

    await runWithTenant(businessId, () =>
      cancelBooking({ bookingId: booking.id, by: 'customer', now: at(9 * 60, '2026-06-28') }),
    );
    expect(await runWithTenant(businessId, () => countUnseenChanges())).toBe(1);
  });

  it('flags the individual booking too, not just the total', async () => {
    const day = await runWithTenant(businessId, () =>
      listBookingsForDay({ businessId, date: '2026-06-29' }),
    );
    expect(day.some((b) => b.needsAttention)).toBe(true);
  });
});

describe('findOrCreateCustomer', () => {
  it('returns the existing customer for a number typed differently', async () => {
    const again = await runWithTenant(businessId, () =>
      findOrCreateCustomer({ name: 'Ada Again', phone: '+972 50 111 2222', callingCode: '972' }),
    );
    expect(again.id).toBe(adaId);
    expect(again.created).toBe(false);
    expect(again.name).toBe('Ada');
  });

  it('creates a new customer when the number is unknown', async () => {
    const fresh = await runWithTenant(businessId, () =>
      findOrCreateCustomer({ name: 'Grace', phone: '0503334444', callingCode: '972' }),
    );
    expect(fresh.created).toBe(true);
    expect(fresh.phone).toBe('+972503334444');
  });
});
