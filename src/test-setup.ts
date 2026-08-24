/**
 * Test bootstrap.
 *
 * Points DATABASE_URL at the throwaway test database. Database-backed tests are the
 * point here — there is no mocking layer, because a mocked Postgres cannot prove an
 * RLS policy does what it claims.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
