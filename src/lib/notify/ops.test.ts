/**
 * The server-to-server surface.
 *
 * `OPS_TOKEN` is a deployment secret that reads across every tenant on the instance, so
 * it is never handed to a user and never appears in a URL. These tests are mostly about
 * what happens when it is absent or wrong.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBooking } from '../booking';
import { query, systemQueryOne } from '../db';
import { runWithTenant } from '../tenant';
import { startTestTransaction, type TestDatabase } from '../test-db';
import { localToInstant } from '../time';
import { authorizeOps, drainDue, listDueAcrossTenants } from './ops';
import { enqueue } from './queue';

const TZ = 'Asia/Jerusalem';
const at = (m: number, day = '2026-11-09') => localToInstant(day, m, TZ);

describe('authorizeOps', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Closed unless switched on. A deployment that never sets OPS_TOKEN has no
   * server-to-server surface at all, rather than one guarded by an empty string.
   */
  it('is unavailable when no token is configured', () => {
    vi.stubEnv('OPS_TOKEN', '');
    const result = authorizeOps('Bearer anything');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it('rejects a missing header', () => {
    vi.stubEnv('OPS_TOKEN', 'a-long-enough-ops-secret-value');
    const result = authorizeOps(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects a wrong token, and one of a different length', () => {
    vi.stubEnv('OPS_TOKEN', 'a-long-enough-ops-secret-value');
    expect(authorizeOps('Bearer wrong-but-same-length-secret').ok).toBe(false);
    expect(authorizeOps('Bearer short').ok).toBe(false);
  });

  it('accepts the configured token', () => {
    vi.stubEnv('OPS_TOKEN', 'a-long-enough-ops-secret-value');
    expect(authorizeOps('Bearer a-long-enough-ops-secret-value').ok).toBe(true);
  });

  it('does not accept the token without the Bearer scheme', () => {
    vi.stubEnv('OPS_TOKEN', 'a-long-enough-ops-secret-value');
    expect(authorizeOps('a-long-enough-ops-secret-value').ok).toBe(false);
  });
});

describe('draining the queue', () => {
  let db: TestDatabase;
  let businessA: string;
  let businessB: string;

  async function seed(slug: string, name: string): Promise<{ id: string; bookingId: string }> {
    const b = await systemQueryOne<{ id: string }>(
      `INSERT INTO torim.businesses (slug, name, timezone, currency, default_calling_code)
       VALUES ($1, $2, $3, 'ILS', '972') RETURNING id`,
      [slug, name, TZ],
    );
    const id = b!.id;
    const bookingId = await runWithTenant(id, async () => {
      const s = await query<{ id: string }>(
        `INSERT INTO torim.services (name, duration_min, price_minor)
         VALUES ('Cut', 30, 12000) RETURNING id`,
      );
      const c = await query<{ id: string }>(
        `INSERT INTO torim.customers (name, phone_e164, email)
         VALUES ('Ada', '+1555019' || floor(random()*1000)::int::text, 'ada@example.invalid')
         RETURNING id`,
      );
      const booking = await createBooking({
        businessId: id,
        customerId: c[0]!.id,
        serviceId: s[0]!.id,
        startsAt: at(10 * 60),
        source: 'customer',
        allowOverlap: true,
      });
      await enqueue({
        bookingId: booking.id,
        kind: 'booking_confirmed',
        channel: 'email',
        locale: 'en',
        sendAfter: at(9 * 60),
      });
      return booking.id;
    });
    return { id, bookingId };
  }

  beforeAll(async () => {
    db = await startTestTransaction();
    businessA = (await seed('ops-a', 'Ops A')).id;
    businessB = (await seed('ops-b', 'Ops B')).id;
  });

  afterAll(async () => {
    await db.rollback();
  });

  /**
   * One external drainer serves the whole instance, so the listing spans tenants — but
   * every item carries its own businessId, and the caller must send it back to report
   * an outcome. Nothing is addressable without naming the tenant it belongs to.
   */
  it('lists what is due across every tenant, each tagged with its business', async () => {
    const due = await listDueAcrossTenants({ now: at(9 * 60 + 1) });
    const businesses = new Set(due.map((n) => n.businessId));
    expect(businesses.has(businessA)).toBe(true);
    expect(businesses.has(businessB)).toBe(true);
    expect(due.every((n) => typeof n.businessSlug === 'string')).toBe(true);
  });

  it('respects an overall limit', async () => {
    const due = await listDueAcrossTenants({ now: at(9 * 60 + 1), limit: 1 });
    expect(due).toHaveLength(1);
  });

  it('returns nothing before anything is due', async () => {
    expect(await listDueAcrossTenants({ now: at(8 * 60) })).toEqual([]);
  });

  /**
   * With the default transport nothing is sendable, and that must be recorded as skipped
   * rather than failed — it is not going to start working on a retry.
   */
  it('marks everything skipped when no transport is configured', async () => {
    const summary = await drainDue({ now: at(9 * 60 + 1) });

    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBeGreaterThan(0);

    const rows = await runWithTenant(businessA, () =>
      query<{ status: string; transport: string }>(
        `SELECT status, transport FROM torim.notifications`,
      ),
    );
    expect(rows.every((r) => r.status === 'skipped')).toBe(true);
    expect(rows.every((r) => r.transport === 'none')).toBe(true);
  });

  it('leaves nothing due once drained', async () => {
    expect(await listDueAcrossTenants({ now: at(9 * 60 + 1) })).toEqual([]);
  });
});
