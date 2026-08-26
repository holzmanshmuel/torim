/**
 * Demo-database reset: the pure, testable half of `scripts/reset-demo.ts`.
 *
 * Split out for the same reason `src/lib/seed-safety.ts` is split out from
 * `scripts/seed-demo.ts`: the script's job — loading env, opening a real Postgres
 * connection, and calling `process.exit()` on failure — cannot be exercised from a
 * test runner, so the parts that actually decide something live here instead, as
 * plain functions taking a `pg` client.
 *
 * `npm run db:reset` exists to return the public hosted demo's database to a known,
 * empty state every night before `npm run db:seed` re-creates the "demo" business.
 * Unlike the seed script — which only ever touches rows belonging to its own "demo"
 * business, on purpose — this empties every table in schema `torim`, for every
 * business, so it has to be strictly more careful about which tables it touches and
 * how it decides to touch them.
 */
import type { Client, ClientBase } from 'pg';

/**
 * Any `pg` client-like value the query methods below need — just enough of the
 * interface to be testable against either a real `pg.Client` (the script) or the
 * same thing in a test. Kept narrow on purpose, matching `src/lib/rls.test.ts`'s
 * own catalog queries, which also only ever need `.query()`.
 */
export type QueryableClient = Pick<ClientBase, 'query'> | Client;

/**
 * Every base table in schema `torim` except the migration bookkeeping table
 * `torim.schema_migrations`.
 *
 * This is the catalog-driven discovery the task calls for: it reads
 * `information_schema.tables` rather than naming tables in a list here, because a
 * hardcoded list is exactly the kind of invariant this codebase refuses to lean on
 * memory for (see the "every tenant table is protected" describe block in
 * `src/lib/rls.test.ts`, which does the same thing for RLS policies). A hardcoded
 * list would silently stop covering the N+1th table the moment someone adds a
 * migration; querying the catalog means a newly-added table is truncated
 * automatically, with nobody having to remember to list it here.
 *
 * Unlike `rls.test.ts`'s guard, there is no EXEMPT set to maintain and no
 * "unclassified table" failure mode to trip: every table in the schema gets wiped
 * except the one migration-bookkeeping table named directly in the query, so a new
 * table needs no deliberate classification to be covered — it is covered by
 * default, which is the point of a reset script.
 */
export async function tablesToTruncate(client: QueryableClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'torim'
        AND table_type = 'BASE TABLE'
        AND table_name <> 'schema_migrations'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

/**
 * Empty every table named in `tables` in one statement.
 *
 * RESTART IDENTITY so any serial/identity sequence starts fresh, matching a
 * genuinely empty database rather than one that merely has no rows. CASCADE is
 * required, not optional politeness: `torim.bookings` references `torim.customers`
 * and `torim.services`, `torim.memberships` references `torim.businesses` and
 * `torim.users`, and so on — TRUNCATE refuses outright to touch a table that has a
 * foreign key pointing at it from a table not also named in the same statement,
 * unless told to cascade. Truncating every table in the schema in one call sidesteps
 * having to work out that dependency order by hand.
 *
 * A no-op when `tables` is empty (rather than emitting `TRUNCATE TABLE ` with
 * nothing after it, which is a SQL syntax error) — that keeps this safe to call
 * against a database schema `torim` has not even been migrated into yet.
 *
 * Table names are trusted here, not user input: they come straight out of
 * `tablesToTruncate()`'s catalog query, i.e. names Postgres itself already accepted
 * as real identifiers in this schema — the same trust level `scripts/grant-app-role.ts`
 * places in its (regex-checked) role name.
 */
export async function truncateTables(client: QueryableClient, tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const identifiers = tables.map((table) => `torim.${table}`).join(', ');
  await client.query(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
}
