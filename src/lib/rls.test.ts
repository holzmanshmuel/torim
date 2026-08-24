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

/**
 * The guard that makes the next table safe by default.
 *
 * Tenant isolation is only as good as its least-protected table, and the failure mode is
 * silent: add a table, forget the policy, and every business reads every other business's
 * rows with no error anywhere. Rather than trusting a checklist at review time, this
 * asserts the invariant over whatever tables actually exist — so the N+1th table cannot
 * be forgotten, only deliberately exempted here.
 */
describe('every tenant table is protected', () => {
  /**
   * The tenancy tables themselves. They must be readable *before* a tenant context
   * exists — resolving a public booking slug, signing a user in, onboarding an owner who
   * has no business yet — so RLS on them would deadlock the app against itself.
   * schema_migrations is the migration runner's bookkeeping and the app role cannot read
   * it at all.
   */
  const EXEMPT = new Set(['businesses', 'users', 'memberships', 'schema_migrations']);

  it('has row-level security enabled, forced, and a tenant policy', async () => {
    const tables = await systemQuery<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policy_count: string;
    }>(
      `SELECT c.relname AS table_name,
              c.relrowsecurity      AS rls_enabled,
              c.relforcerowsecurity AS rls_forced,
              (SELECT count(*) FROM pg_policy p
                WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policy_count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'torim' AND c.relkind = 'r'
        ORDER BY c.relname`,
    );

    expect(tables.length).toBeGreaterThan(0);

    const unprotected = tables
      .filter((t) => !EXEMPT.has(t.table_name))
      .filter((t) => !t.rls_enabled || !t.rls_forced || Number(t.policy_count) === 0)
      .map(
        (t) =>
          `${t.table_name} (enabled=${t.rls_enabled}, forced=${t.rls_forced}, ` +
          `policies=${t.policy_count})`,
      );

    expect(unprotected).toEqual([]);
  });

  it('knows about every table, so a new one has to be classified', async () => {
    // Fails when a table is added, forcing a deliberate choice: give it a tenant policy,
    // or add it to EXEMPT with a reason. Either way, somebody decided.
    const tables = await systemQuery<{ table_name: string }>(
      `SELECT c.relname AS table_name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'torim' AND c.relkind = 'r'`,
    );
    const known = new Set([
      ...EXEMPT,
      'services',
      'working_hours',
      'date_overrides',
      'closures',
      'customers',
      'bookings',
      'notifications',
    ]);
    const unclassified = tables.map((t) => t.table_name).filter((n) => !known.has(n));
    expect(unclassified).toEqual([]);
  });
});
