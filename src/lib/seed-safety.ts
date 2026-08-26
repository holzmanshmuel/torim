/**
 * Seed safety: deciding whether a database NAME looks disposable.
 *
 * `scripts/seed-demo.ts` is destructive — it deletes and re-inserts every row
 * belonging to the "demo" business — and its only guard against running against a
 * real database is the shape of the target database's name. That decision is pure
 * string matching, so it lives here as a plain function, separate from
 * `assertSafeToSeed()`'s job of reading DATABASE_URL, parsing it, and calling
 * `process.exit()` on failure. The latter cannot be unit tested directly — there
 * is no way to assert on a process exit from inside a test runner without killing
 * the runner — so the part that actually decides is pulled out instead.
 *
 * This takes a bare database name rather than a connection string, on purpose:
 * naming the disposable suffixes is the only thing this function knows how to do,
 * and every test case for that is just a string. Parsing DATABASE_URL — including
 * what "unset" and "not a valid connection string" mean — is a distinct concern
 * with its own error handling, and stays in `assertSafeToSeed()` unchanged.
 */

/**
 * Suffixes that mark a database as disposable by name alone: local development,
 * the test suite's own database, and the public hosted demo. Matched at the END
 * of the name only — "my_dev_prod" does not qualify, because the point of the
 * check is that the LAST thing anyone named the database was "this is throwaway",
 * not that one of these words merely appears somewhere inside a longer, possibly
 * real, name.
 */
const DISPOSABLE_NAME_SUFFIX = /(_dev|_test|_demo)$/i;

/**
 * Does this database name look like something safe to destroy and recreate?
 *
 * A bare "demo" (no underscore) does NOT count — the rule is a suffix on a
 * deliberately chosen name, not a keyword search. Requiring the underscore keeps
 * the bar for "_demo" exactly as strict as it already was for "_dev" and "_test",
 * rather than quietly loosening it for the newest of the three.
 */
export function isDisposableDatabaseName(dbName: string): boolean {
  return DISPOSABLE_NAME_SUFFIX.test(dbName);
}
