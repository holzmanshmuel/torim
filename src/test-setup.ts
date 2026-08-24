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

/**
 * A fixed, throwaway session seal for the suite.
 *
 * Not a secret: it never reaches a running app, only vitest. It is here so the suite is
 * self-contained — a fresh clone, a fork's CI, and a contributor with no .env.local all
 * run the same tests. Relying on an ambient SESSION_PASSWORD instead is how the auth
 * tests passed on a developer machine and failed on the first clean CI run.
 *
 * Tests that assert the missing/too-short behaviour set and restore the variable
 * themselves.
 */
process.env.SESSION_PASSWORD ??=
  'test-only-session-password-not-a-secret-0123456789';
