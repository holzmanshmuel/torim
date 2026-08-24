/**
 * The race, run for real.
 *
 * This file deliberately does NOT use the rollback-per-test helper: that helper pins
 * every query to one connection inside one transaction, which is the opposite of what a
 * concurrency test needs. These tests use the real pool, commit, and clean up after
 * themselves.
 *
 * The second test is the control. It performs the same check-then-insert *without* the
 * advisory lock and shows that two customers do double-book — so the first test is
 * demonstrably passing because of the lock, not because the race never happens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingConflictError, createBooking } from './booking';
import { closePool, query, systemQuery, systemQueryOne, withTransaction } from './db';
import { runWithTenant } from './tenant';
import { localToInstant } from './time';

const TZ = 'Asia/Jerusalem';
const SLUG = 'race-test';

let businessId: string;
let serviceId: string;
let customerA: string;
let customerB: string;

beforeAll(async () => {
  await systemQuery('DELETE FROM torim.businesses WHERE slug = $1', [SLUG]);

  const business = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ($1, 'Race Test', $2, 'ILS') RETURNING id`,
    [SLUG, TZ],
  );
  businessId = business!.id;

  await runWithTenant(businessId, async () => {
    const services = await query<{ id: string }>(
      `INSERT INTO torim.services (name, duration_min, price_minor)
       VALUES ('Cut', 60, 12000) RETURNING id`,
    );
    serviceId = services[0]!.id;

    const customers = await query<{ id: string }>(
      `INSERT INTO torim.customers (name, phone_e164)
       VALUES ('Ada', '+15550199001'), ('Grace', '+15550199002') RETURNING id`,
    );
    customerA = customers[0]!.id;
    customerB = customers[1]!.id;
  });
});

afterAll(async () => {
  await systemQuery('DELETE FROM torim.businesses WHERE slug = $1', [SLUG]);
  await closePool();
});

describe('two customers racing for the last slot', () => {
  it('lets exactly one of them win', async () => {
    const slot = localToInstant('2026-07-06', 10 * 60, TZ);

    const attempts = await Promise.allSettled([
      runWithTenant(businessId, () =>
        createBooking({
          businessId,
          customerId: customerA,
          serviceId,
          startsAt: slot,
          source: 'customer',
        }),
      ),
      runWithTenant(businessId, () =>
        createBooking({
          businessId,
          customerId: customerB,
          serviceId,
          startsAt: slot,
          source: 'customer',
        }),
      ),
    ]);

    const won = attempts.filter((a) => a.status === 'fulfilled');
    const lost = attempts.filter((a) => a.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(BookingConflictError);

    // And the database agrees: one live booking in that slot, not two.
    const live = await runWithTenant(businessId, () =>
      query<{ id: string }>(
        `SELECT id FROM torim.bookings
          WHERE starts_at = $1 AND status IN ('pending', 'confirmed')`,
        [slot],
      ),
    );
    expect(live).toHaveLength(1);
  });

  /**
   * Control. Same two writers, same slot, but the lock is omitted — so both read an
   * empty slot before either has committed, and both insert. If this test ever stops
   * double-booking, the test above has stopped proving anything and this control needs
   * rewriting rather than deleting.
   */
  it('double-books without the lock, which is what the lock is for', async () => {
    const slot = localToInstant('2026-07-07', 10 * 60, TZ);

    const bookUnlocked = (customerId: string) =>
      runWithTenant(businessId, () =>
        withTransaction(async (client) => {
          const endsAt = new Date(slot.getTime() + 60 * 60_000);

          const { rows: clash } = await client.query<{ id: string }>(
            `SELECT id FROM torim.bookings
              WHERE status IN ('pending', 'confirmed')
                AND blocks_from < $2 AND blocks_until > $1
              LIMIT 1`,
            [slot, endsAt],
          );
          if (clash.length > 0) throw new BookingConflictError(clash[0]!.id);

          // Give the sibling transaction time to run its own check before this one
          // inserts, so the interleaving is the one that actually bites in production.
          await new Promise((resolve) => setTimeout(resolve, 50));

          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO torim.bookings
               (customer_id, service_id, starts_at, ends_at, price_minor, source)
             VALUES ($1, $2, $3, $4, 12000, 'customer') RETURNING id`,
            [customerId, serviceId, slot, endsAt],
          );
          return rows[0]!.id;
        }),
      );

    await Promise.all([bookUnlocked(customerA), bookUnlocked(customerB)]);

    const live = await runWithTenant(businessId, () =>
      query<{ id: string }>(
        `SELECT id FROM torim.bookings
          WHERE starts_at = $1 AND status IN ('pending', 'confirmed')`,
        [slot],
      ),
    );
    expect(live).toHaveLength(2);
  });
});
