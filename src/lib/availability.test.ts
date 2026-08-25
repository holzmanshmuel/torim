/**
 * The read side of the public booking flow, against real Postgres.
 *
 * These sit between the pure slot engine (slots.ts) and the database: they load a
 * business's hours, closures, overrides and existing bookings, then hand them to the
 * engine. The engine's own rules are tested in slots.test.ts; what is tested here is
 * that the right rows reach it, tenant-scoped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAvailability, getService, listActiveServices } from './availability';
import { findBusinessBySlug } from './businesses';
import { createBooking } from './booking';
import { query, systemQueryOne } from './db';
import { runWithTenant } from './tenant';
import { startTestTransaction, type TestDatabase } from './test-db';
import { instantToMinutes, localToInstant } from './time';

const TZ = 'Asia/Jerusalem';
/** 2026-06-15 is a Monday. */
const MONDAY = '2026-06-15';
const at = (minutes: number, day = MONDAY) => localToInstant(day, minutes, TZ);
/** Well before the fixture week, so minimum notice never interferes. */
const EARLY = at(8 * 60, '2026-01-05');

let db: TestDatabase;
let businessId: string;
let otherBusinessId: string;
let cutId: string;
let customerId: string;

beforeAll(async () => {
  db = await startTestTransaction();

  const b = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, name_he, timezone, currency, slot_granularity_min,
                                   min_notice_min, max_advance_days)
     VALUES ('avail-test', 'Availability Test', 'בדיקה', $1, 'ILS', 60, 0, 365) RETURNING id`,
    [TZ],
  );
  businessId = b!.id;

  const o = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ('avail-other', 'Other', $1, 'ILS') RETURNING id`,
    [TZ],
  );
  otherBusinessId = o!.id;

  await runWithTenant(businessId, async () => {
    const services = await query<{ id: string }>(
      `INSERT INTO torim.services (name, duration_min, price_minor, sort_order, active)
       VALUES ('Cut', 60, 12000, 1, true),
              ('Colour', 120, 30000, 2, true),
              ('Retired', 30, 5000, 3, false)
       RETURNING id`,
    );
    cutId = services[0]!.id;

    // Monday 09:00–17:00, Friday 09:00–13:00.
    await query(
      `INSERT INTO torim.working_hours (weekday, start_min, end_min)
       VALUES (1, 540, 1020), (5, 540, 780)`,
    );

    const c = await query<{ id: string }>(
      `INSERT INTO torim.customers (name, phone_e164) VALUES ('Ada', '+15550177001') RETURNING id`,
    );
    customerId = c[0]!.id;
  });
});

afterAll(async () => {
  await db.rollback();
});

describe('findBusinessBySlug', () => {
  it('resolves a public slug without any tenant context', async () => {
    const business = await findBusinessBySlug('avail-test');
    expect(business?.id).toBe(businessId);
    expect(business?.name).toBe('Availability Test');
    expect(business?.nameHe).toBe('בדיקה');
    expect(business?.timezone).toBe(TZ);
  });

  it('exposes booking policy as usable numbers', async () => {
    const business = await findBusinessBySlug('avail-test');
    expect(business?.slotGranularityMin).toBe(60);
    expect(business?.minNoticeMin).toBe(0);
    expect(business?.maxAdvanceDays).toBe(365);
    expect(business?.confirmNewCustomers).toBe(false);
  });

  it('returns null for an unknown slug rather than throwing', async () => {
    expect(await findBusinessBySlug('no-such-business')).toBeNull();
  });
});

describe('listActiveServices', () => {
  it('returns only bookable services, in the owner’s order', async () => {
    const services = await runWithTenant(businessId, () => listActiveServices());
    expect(services.map((s) => s.name)).toEqual(['Cut', 'Colour']);
  });

  it('does not leak another business’s catalogue', async () => {
    const services = await runWithTenant(otherBusinessId, () => listActiveServices());
    expect(services).toEqual([]);
  });

  it('getService returns null for a service belonging to another business', async () => {
    expect(await runWithTenant(otherBusinessId, () => getService(cutId))).toBeNull();
  });
});

describe('getAvailability', () => {
  it('builds a week from the business’s own hours', async () => {
    const days = await runWithTenant(businessId, () =>
      getAvailability({ businessId, serviceId: cutId, from: MONDAY, to: '2026-06-21', now: EARLY }),
    );

    expect(days.map((d) => d.date)).toHaveLength(7);
    expect(days[0]!.state).toBe('open'); // Monday
    expect(days[1]!.state).toBe('closed'); // Tuesday, no hours
    expect(days[4]!.state).toBe('open'); // Friday
    expect(days[5]!.state).toBe('closed'); // Saturday
  });

  it('removes slots taken by an existing booking', async () => {
    await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId: cutId,
        startsAt: at(11 * 60),
        source: 'admin',
      }),
    );

    const [monday] = await runWithTenant(businessId, () =>
      getAvailability({ businessId, serviceId: cutId, from: MONDAY, to: MONDAY, now: EARLY }),
    );
    const minutes = monday!.slots.map((s) => instantToMinutes(s, TZ));
    expect(minutes).not.toContain(11 * 60);
    expect(minutes).toContain(10 * 60);
  });

  it('frees a slot again once its booking is cancelled', async () => {
    const booking = await runWithTenant(businessId, () =>
      createBooking({
        businessId,
        customerId,
        serviceId: cutId,
        startsAt: at(14 * 60),
        source: 'admin',
      }),
    );

    let [monday] = await runWithTenant(businessId, () =>
      getAvailability({ businessId, serviceId: cutId, from: MONDAY, to: MONDAY, now: EARLY }),
    );
    expect(monday!.slots.map((s) => instantToMinutes(s, TZ))).not.toContain(14 * 60);

    await runWithTenant(businessId, () =>
      query(`UPDATE torim.bookings SET status = 'cancelled' WHERE id = $1`, [booking.id]),
    );

    [monday] = await runWithTenant(businessId, () =>
      getAvailability({ businessId, serviceId: cutId, from: MONDAY, to: MONDAY, now: EARLY }),
    );
    expect(monday!.slots.map((s) => instantToMinutes(s, TZ))).toContain(14 * 60);
  });

  it('honours a closure', async () => {
    await runWithTenant(businessId, () =>
      query(
        `INSERT INTO torim.closures (on_date, start_min, end_min, kind, label)
         VALUES ('2026-06-22', NULL, NULL, 'manual', 'Vacation')`,
      ),
    );

    const [day] = await runWithTenant(businessId, () =>
      getAvailability({
        businessId,
        serviceId: cutId,
        from: '2026-06-22',
        to: '2026-06-22',
        now: EARLY,
      }),
    );
    expect(day!.state).toBe('closed');
  });

  it('honours a per-date override that opens a normally-closed day', async () => {
    // Tuesday has no weekly hours at all.
    await runWithTenant(businessId, () =>
      query(
        `INSERT INTO torim.date_overrides (on_date, start_min, end_min, label)
         VALUES ('2026-06-16', 600, 780, 'Special opening')`,
      ),
    );

    const [day] = await runWithTenant(businessId, () =>
      getAvailability({
        businessId,
        serviceId: cutId,
        from: '2026-06-16',
        to: '2026-06-16',
        now: EARLY,
      }),
    );
    expect(day!.state).toBe('open');
    expect(day!.slots.map((s) => instantToMinutes(s, TZ))).toEqual([600, 660, 720]);
  });

  it('refuses a service that is not this business’s', async () => {
    await expect(
      runWithTenant(otherBusinessId, () =>
        getAvailability({
          businessId: otherBusinessId,
          serviceId: cutId,
          from: MONDAY,
          to: MONDAY,
          now: EARLY,
        }),
      ),
    ).rejects.toThrow(/service/i);
  });
});
