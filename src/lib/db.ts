/**
 * Postgres access.
 *
 * Two entry points, and the difference matters:
 *   query()/withTransaction()  — tenant-scoped. Sets the `torim.business_id` GUC
 *                                inside the transaction; RLS policies read it back.
 *                                Throws if no tenant context is established.
 *   systemQuery()/withSystemTransaction() — NO tenant GUC. Only legal against the
 *                                non-RLS tenancy tables (businesses, users,
 *                                memberships), which must be readable *before* a
 *                                tenant exists (sign-in, onboarding, slug lookup).
 *
 * ⚠ DATABASE_URL must point at a non-superuser role without BYPASSRLS.
 * Postgres silently skips RLS for superusers — no error, every tenant's data leaks
 * to every other tenant. `npm run db:check-role` asserts this; CI asserts it too.
 */
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { requireBusinessId } from './tenant';

export const TENANT_GUC = 'torim.business_id';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set.');
    }
    pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }
  return pool;
}

/**
 * Point the module at a caller-supplied pool. Tests use this to pin every query to a
 * single connection inside one transaction, so a whole test file can be rolled back.
 */
export function __setPoolForTests(replacement: Pool | undefined): void {
  pool = replacement;
}

/** Release the pool. Tests and scripts call this; the server never does. */
export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside a transaction with the tenant GUC set.
 * `set_config(..., true)` is transaction-local, so the scope cannot leak to the
 * next user of this pooled connection.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const businessId = requireBusinessId();
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT set_config($1, $2, true)', [TENANT_GUC, businessId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/** Single tenant-scoped statement. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withTransaction(async (client) => (await client.query<T>(sql, params)).rows);
}

/** Tenant-scoped statement expecting at most one row. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Transaction with NO tenant GUC — for the non-RLS tenancy tables only.
 * Reach for this deliberately; it is the one path RLS does not cover.
 */
export async function withSystemTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function systemQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withSystemTransaction(async (client) => (await client.query<T>(sql, params)).rows);
}

export async function systemQueryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await systemQuery<T>(sql, params);
  return rows[0] ?? null;
}
