/**
 * Grant the restricted application role.
 *
 * Run once after `npm run migrate`, connected as the schema owner:
 *   DATABASE_URL="postgres://owner@localhost:5432/torim_dev" npm run db:grant
 *
 * The role it creates must be able to read and write rows, and nothing else — no DDL,
 * no superuser, no BYPASSRLS. `npm run db:check-role` asserts that afterwards.
 */
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const ROLE = process.env.APP_DB_ROLE ?? 'torim_app';
const PASSWORD = process.env.APP_DB_PASSWORD;

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Point it at the schema owner.');
    process.exit(1);
  }
  if (!PASSWORD) {
    console.error('APP_DB_PASSWORD is not set. Choose the password for the app role.');
    process.exit(1);
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(ROLE)) {
    console.error(`APP_DB_ROLE "${ROLE}" is not a plain identifier.`);
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
           CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
         END IF;
       END $$;`,
    );
    // ALTER ROLE is a utility statement and takes no bind parameters, so the password
    // has to be inlined — escaped by the driver, never by hand.
    await client.query(`ALTER ROLE ${ROLE} WITH PASSWORD ${client.escapeLiteral(PASSWORD)}`);
    await client.query(`ALTER ROLE ${ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);

    await client.query(`GRANT USAGE ON SCHEMA torim TO ${ROLE}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA torim TO ${ROLE}`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA torim TO ${ROLE}`);
    await client.query(
      `GRANT EXECUTE ON FUNCTION torim.create_business_with_owner(uuid, text, text, text, text) TO ${ROLE}`,
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION torim.business_for_manage_token(text) TO ${ROLE}`,
    );

    // The migration bookkeeping table is the owner's business, not the app's.
    await client.query(`REVOKE ALL ON torim.schema_migrations FROM ${ROLE}`);

    console.log(`Granted schema torim to role "${ROLE}".`);
    console.log('Verify with: npm run db:check-role');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
