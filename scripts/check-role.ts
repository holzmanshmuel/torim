/**
 * Assert that DATABASE_URL points at a role RLS actually applies to.
 *
 * Postgres silently skips row-level security for superusers and for roles with
 * BYPASSRLS. There is no error and no warning — the tenant policies simply do nothing
 * and every business sees every other business's bookings. A test suite run against
 * such a role passes all its isolation tests while proving nothing.
 *
 * CI runs this before the suite. Run it locally whenever DATABASE_URL changes.
 */
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user, r.rolsuper, r.rolbypassrls
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const me = rows[0];
    if (!me) {
      console.error('Could not resolve the current role.');
      process.exit(1);
    }

    const problems: string[] = [];
    if (me.rolsuper) problems.push('is a SUPERUSER');
    if (me.rolbypassrls) problems.push('has BYPASSRLS');

    if (problems.length > 0) {
      console.error(
        `DATABASE_URL connects as "${me.current_user}", which ${problems.join(' and ')}.\n` +
          'Row-level security is silently skipped for such roles — every tenant would read\n' +
          'every other tenant. Point DATABASE_URL at the restricted app role instead\n' +
          '(npm run db:grant creates it).',
      );
      process.exit(1);
    }

    console.log(`OK — connected as "${me.current_user}" (not superuser, no BYPASSRLS).`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
