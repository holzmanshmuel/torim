/**
 * Demo database reset.
 *
 * The public hosted demo lets anyone sign in with Google and create their own
 * business — so its database accumulates real strangers' user rows and businesses
 * over time, not just the fictional "demo" business `npm run db:seed` maintains.
 * This script exists to be run nightly, right before `npm run db:seed`, to return
 * that database to a known, empty state: it TRUNCATEs every table in schema `torim`
 * except the migration bookkeeping table `torim.schema_migrations`, for every
 * business, not just "demo".
 *
 * That is a materially different — and larger — blast radius than `npm run db:seed`,
 * which deliberately touches only rows belonging to its own "demo" business and
 * leaves everyone else alone. This script leaves nobody alone. Do not reach for it
 * unless emptying the whole database really is the goal.
 *
 * Discovers the tables to truncate from the Postgres catalog rather than naming them
 * here — see src/lib/reset-demo.ts's tablesToTruncate() for why: a hardcoded list
 * would silently stop covering the N+1th table the day someone adds a migration.
 *
 * Runs as the schema OWNER, like scripts/migrate.ts and scripts/grant-app-role.ts —
 * TRUNCATE is an owner-level operation, and the restricted `torim_app` role is
 * deliberately not granted it (see scripts/grant-app-role.ts's own grants, which stop
 * at SELECT/INSERT/UPDATE/DELETE).
 *
 * Guarded the same way `npm run db:seed` is guarded, and then some: it refuses to run
 * unless the target database's name looks disposable (ends `_dev`, `_test`, or
 * `_demo` — see src/lib/seed-safety.ts), with the same `ALLOW_DESTRUCTIVE_SEED=1`
 * escape hatch. Being strictly more destructive than the seed script, it would be
 * indefensible to guard this one any less loudly.
 *
 * Run with:
 *   MIGRATE_DATABASE_URL=postgres://<owner>@localhost:5432/torim_demo npm run db:reset
 */
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

import { tablesToTruncate, truncateTables } from '../src/lib/reset-demo';
import { isDisposableDatabaseName } from '../src/lib/seed-safety';

/**
 * Refuse to run against anything that doesn't look like a throwaway database.
 * Loud, non-zero exit, explained — never a silent no-op and never "just this once".
 *
 * Takes the connection string as a parameter rather than reading DATABASE_URL itself,
 * on purpose: this script connects as the schema OWNER
 * (MIGRATE_DATABASE_URL ?? DATABASE_URL), and those two can legitimately differ — a
 * developer's own MIGRATE_DATABASE_URL is commonly pointed at a different database
 * than DATABASE_URL entirely (see README's testing instructions). Guarding whichever
 * URL this script is NOT about to connect with would defeat the guard's whole
 * purpose, so the caller must pass the exact string main() is about to open a
 * connection to.
 */
function assertSafeToReset(ownerConnectionString: string): void {
  if (process.env.ALLOW_DESTRUCTIVE_SEED === '1') {
    console.warn('ALLOW_DESTRUCTIVE_SEED=1 is set — skipping the disposable-database-name check.\n');
    return;
  }

  let dbName: string;
  try {
    dbName = new URL(ownerConnectionString).pathname.replace(/^\//, '');
  } catch {
    console.error('The schema-owner connection string is not a valid connection string.');
    process.exit(1);
    return;
  }

  if (!isDisposableDatabaseName(dbName)) {
    console.error(
      `Refusing to run: the schema-owner connection points at database "${dbName}", which\n` +
        'does not look like a disposable database (expected a name ending in "_dev", "_test",\n' +
        'or "_demo").\n\n' +
        'This script is MORE destructive than `npm run db:seed` — it TRUNCATEs every table in\n' +
        'schema torim except schema_migrations, for every business, not just "demo". Running it\n' +
        'against a real database would destroy every real business with no way back.\n\n' +
        'If this really is the right database, set ALLOW_DESTRUCTIVE_SEED=1 to override.',
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // The schema OWNER connection, exactly like scripts/migrate.ts and
  // scripts/grant-app-role.ts: TRUNCATE needs owner-level rights the restricted app
  // role does not have.
  const connectionString = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      'Neither MIGRATE_DATABASE_URL nor DATABASE_URL is set.\n' +
        'This script needs the SCHEMA OWNER connection — the same one `npm run migrate` and\n' +
        '`npm run db:grant` use — because TRUNCATE is an owner-level operation the restricted\n' +
        'app role is deliberately not granted. Set MIGRATE_DATABASE_URL.',
    );
    process.exit(1);
    return;
  }

  assertSafeToReset(connectionString);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    console.log('Resetting the demo database: emptying every table in schema torim except schema_migrations...\n');

    const tables = await tablesToTruncate(client);
    if (tables.length === 0) {
      console.log(
        'No tables found in schema torim (aside from schema_migrations, if even that exists).\n' +
          'Has `npm run migrate` been run against this database?',
      );
      return;
    }

    await truncateTables(client, tables);

    console.log(`Truncated ${tables.length} table(s):`);
    for (const table of tables) console.log(`  torim.${table}`);
    console.log('\nDone. Run `npm run db:seed` to reload the demo business.');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
