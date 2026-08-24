/**
 * Tenant isolation, proven against a real Postgres.
 *
 * These assertions are about the RLS policies, not about application intent — which is
 * why they run real SQL as the real application role. Run against a role that is a
 * superuser or has BYPASSRLS and they would all pass while proving nothing; `npm run
 * db:check-role` exists to stop that.
 *
 * Requires: TEST_DATABASE_URL migrated (`npm run migrate`) and granted (`npm run db:grant`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query, systemQuery, systemQueryOne } from './db';
import { runWithTenant } from './tenant';
import { startTestTransaction, type TestDatabase } from './test-db';

let db: TestDatabase;
let businessA: string;
let businessB: string;

async function makeBusiness(slug: string, name: string): Promise<string> {
  const row = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ($1, $2, 'Asia/Jerusalem', 'ILS') RETURNING id`,
    [slug, name],
  );
  if (!row) throw new Error('business insert returned nothing');
  return row.id;
}

beforeAll(async () => {
  db = await startTestTransaction();
  businessA = await makeBusiness('rls-test-a', 'Tenant A');
  businessB = await makeBusiness('rls-test-b', 'Tenant B');
});

afterAll(async () => {
  await db.rollback();
});

describe('row-level security', () => {
  it('refuses a tenant-scoped query with no tenant context', async () => {
    await expect(query('SELECT 1 FROM torim.services')).rejects.toThrow(/No tenant context/);
  });

  it('scopes reads to the active business', async () => {
    await runWithTenant(businessA, () =>
      query(
        `INSERT INTO torim.services (name, duration_min, price_minor) VALUES ($1, 60, 12000)`,
        ['A haircut'],
      ),
    );
    await runWithTenant(businessB, () =>
      query(
        `INSERT INTO torim.services (name, duration_min, price_minor) VALUES ($1, 30, 8000)`,
        ['B manicure'],
      ),
    );

    const asA = await runWithTenant(businessA, () =>
      query<{ name: string }>('SELECT name FROM torim.services'),
    );
    const asB = await runWithTenant(businessB, () =>
      query<{ name: string }>('SELECT name FROM torim.services'),
    );

    expect(asA.map((r) => r.name)).toEqual(['A haircut']);
    expect(asB.map((r) => r.name)).toEqual(['B manicure']);
  });

  it('defaults business_id from the tenant context, so an insert cannot omit it', async () => {
    const rows = await runWithTenant(businessA, () =>
      query<{ business_id: string }>(
        `INSERT INTO torim.services (name, duration_min, price_minor)
         VALUES ('defaulted', 45, 9000) RETURNING business_id`,
      ),
    );
    expect(rows[0]?.business_id).toBe(businessA);
  });

  it('rejects writing a row into another tenant', async () => {
    await expect(
      runWithTenant(businessA, () =>
        query(
          `INSERT INTO torim.services (business_id, name, duration_min, price_minor)
           VALUES ($1, 'smuggled', 30, 5000)`,
          [businessB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects updating another tenant’s row, and cannot even see it to try', async () => {
    const updated = await runWithTenant(businessA, () =>
      query(`UPDATE torim.services SET name = 'hijacked' WHERE name = 'B manicure' RETURNING id`),
    );
    expect(updated).toHaveLength(0);

    const stillThere = await runWithTenant(businessB, () =>
      query<{ name: string }>(`SELECT name FROM torim.services WHERE name = 'B manicure'`),
    );
    expect(stillThere).toHaveLength(1);
  });

  it('deletes cannot reach across tenants', async () => {
    const deleted = await runWithTenant(businessA, () =>
      query(`DELETE FROM torim.services WHERE name = 'B manicure' RETURNING id`),
    );
    expect(deleted).toHaveLength(0);
  });

  it('sees nothing at all when the tenant GUC is empty', async () => {
    // systemQuery deliberately sets no GUC. Against an RLS table that must read as empty,
    // never as "everything".
    const rows = await systemQuery('SELECT id FROM torim.services');
    expect(rows).toHaveLength(0);
  });
});
