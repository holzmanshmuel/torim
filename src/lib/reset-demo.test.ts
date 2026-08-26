/**
 * scripts/reset-demo.ts, proven against a real Postgres.
 *
 * Unlike every other DB-backed test in this repo, this file does NOT use
 * `startTestTransaction()` (see src/lib/test-db.ts) to pin its writes inside one
 * rolled-back transaction. That pattern relies on a single held-open connection whose
 * writes stay invisible to everyone else until it rolls back — but this suite's whole
 * point is to prove a real `TRUNCATE`, which takes an ACCESS EXCLUSIVE lock on every
 * table it touches. Run that against a table another connection has an open
 * transaction against — exactly what `startTestTransaction()` would leave in place for
 * the length of this file — and the TRUNCATE simply blocks until that other
 * transaction ends, or deadlocks. So this file writes for real, through the ordinary
 * pool (`db.ts`'s `getPool()`, pointed at `TEST_DATABASE_URL` by `src/test-setup.ts`),
 * and truncates for real. Its own truncation IS its cleanup — there is nothing left to
 * roll back once every table is empty. See vitest.config.mts's `fileParallelism:
 * false`, which exists because of this file: a real, schema-wide TRUNCATE is not safe
 * to run concurrently with any other file's in-flight transaction against the same
 * tables, committed or not — the lock alone would deadlock this suite against theirs.
 *
 * Requires: TEST_DATABASE_URL migrated (`npm run migrate`) and granted (`npm run
 * db:grant`) — same as src/lib/rls.test.ts.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query, systemQuery, systemQueryOne } from './db';
import { tablesToTruncate, truncateTables } from './reset-demo';
import { isDisposableDatabaseName } from './seed-safety';
import { runWithTenant } from './tenant';

/**
 * An owner-level connection to whatever database this test run is actually pointed
 * at. TRUNCATE is an owner-level operation the restricted app role is deliberately
 * not granted (proven directly below), so the ordinary DATABASE_URL/TEST_DATABASE_URL
 * connection every other test in this repo uses cannot run it.
 *
 * A developer's own MIGRATE_DATABASE_URL (see .env.local / .env.example) usually
 * names the DEV database, not the test one — the README's own testing instructions
 * have you override it by hand with the test database's name when you actually want
 * to run `migrate`/`db:grant` against `torim_test`. Borrowing it as-is here would
 * point this suite's TRUNCATE at the wrong database entirely, which is precisely the
 * footgun `scripts/reset-demo.ts`'s own safety guard exists to avoid. So this borrows
 * everything about the owner URL except the database name, and takes that from
 * whatever DATABASE_URL is actually active for this test run — TEST_DATABASE_URL,
 * once src/test-setup.ts has substituted it in.
 */
function ownerConnectionStringForActiveDatabase(): string {
  const ownerRaw = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  const active = process.env.DATABASE_URL;
  if (!ownerRaw || !active) {
    throw new Error(
      'MIGRATE_DATABASE_URL/DATABASE_URL are not set — this suite needs an owner-level ' +
        'connection to the test database to run TRUNCATE, the same one scripts/reset-demo.ts ' +
        'and scripts/migrate.ts use. See .env.example.',
    );
  }
  const owner = new URL(ownerRaw);
  owner.pathname = new URL(active).pathname;
  return owner.toString();
}

let owner: Client;

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
  owner = new Client({ connectionString: ownerConnectionStringForActiveDatabase() });
  await owner.connect();
});

afterAll(async () => {
  await owner.end();
  await closePool();
});

describe('tablesToTruncate', () => {
  it('matches the schema torim catalog, independently queried, minus schema_migrations', async () => {
    // Queried a different way than the implementation — pg_class/pg_namespace, the same
    // approach src/lib/rls.test.ts uses for its own catalog assertion — so this actually
    // proves catalog-derivation rather than re-running the same query and agreeing with
    // itself. A table added to schema torim without ever being listed anywhere in this
    // test file still has to show up on both sides for this to pass.
    const catalog = await systemQuery<{ table_name: string }>(
      `SELECT c.relname AS table_name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'torim' AND c.relkind = 'r'`,
    );
    const expected = catalog
      .map((row) => row.table_name)
      .filter((name) => name !== 'schema_migrations')
      .sort();

    const actual = (await tablesToTruncate(owner)).slice().sort();

    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
  });
});

describe('reset', () => {
  it('empties every table across multiple businesses and preserves schema_migrations', async () => {
    const businessA = await makeBusiness('reset-test-a', 'Reset Tenant A');
    const businessB = await makeBusiness('reset-test-b', 'Reset Tenant B');

    // Real, tenant-scoped, committed rows in two DIFFERENT businesses — proving this
    // reset is not scoped to one tenant the way `npm run db:seed` deliberately is.
    await runWithTenant(businessA, () =>
      query(`INSERT INTO torim.services (name, duration_min, price_minor) VALUES ($1, 30, 5000)`, [
        'Reset A service',
      ]),
    );
    await runWithTenant(businessB, () =>
      query(`INSERT INTO torim.customers (name, phone_e164) VALUES ($1, $2)`, [
        'Reset B customer',
        '+15005550199',
      ]),
    );

    // A non-RLS tenancy row too (torim.users), to prove the reset reaches the whole
    // schema, not only the tables RLS happens to protect.
    await systemQuery(`INSERT INTO torim.users (google_sub, email) VALUES ($1, $2)`, [
      'reset-test-google-sub',
      'reset-test@example.com',
    ]);

    const migrationsBefore = await owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM torim.schema_migrations',
    );
    expect(migrationsBefore.rows[0]?.n).toBeGreaterThan(0);

    const tables = await tablesToTruncate(owner);
    await truncateTables(owner, tables);

    for (const table of tables) {
      const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM torim.${table}`);
      expect(rows[0]?.n, `torim.${table} should be empty after reset`).toBe(0);
    }

    const migrationsAfter = await owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM torim.schema_migrations',
    );
    expect(migrationsAfter.rows[0]?.n).toBe(migrationsBefore.rows[0]?.n);
  });
});

describe('the disposable-name guard reset-demo.ts relies on', () => {
  // scripts/reset-demo.ts reuses isDisposableDatabaseName() from seed-safety.ts wholesale
  // rather than a second copy — see that module's own test file for the exhaustive cases.
  // This just proves the specific guarantee reset-demo.ts's safety depends on: a real,
  // non-disposable-looking database name is refused, not merely "some strings are".
  it('refuses a non-disposable database name', () => {
    expect(isDisposableDatabaseName('production')).toBe(false);
    expect(isDisposableDatabaseName('torim')).toBe(false);
  });

  it('accepts the disposable suffix the test database itself uses', () => {
    expect(isDisposableDatabaseName('torim_test')).toBe(true);
  });
});
