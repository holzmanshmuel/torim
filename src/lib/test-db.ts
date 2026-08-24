/**
 * Rollback-per-test database helper.
 *
 * Pins every query in a test file to one connection inside a single transaction that is
 * rolled back at the end, so tests leave no rows behind and never have to clean up after
 * themselves. The alternative — manual `try/finally` DELETEs in each test — is what the
 * predecessor project did, and it leaks whenever an assertion throws first.
 *
 * The trick: hand src/lib/db.ts a pool whose only connection is this pinned client, and
 * translate the BEGIN/COMMIT/ROLLBACK that db.ts issues into SAVEPOINT operations, so the
 * outer transaction survives to be rolled back at the end.
 *
 * Requires a real Postgres. `npm run migrate` must have been run against TEST_DATABASE_URL.
 */
import { Client, type Pool } from 'pg';
import { __setPoolForTests, TENANT_GUC } from './db';

type Sql = { text: string } | string;

function statementOf(sql: Sql): string {
  return (typeof sql === 'string' ? sql : sql.text).trim().toUpperCase();
}

export type TestDatabase = { rollback: () => Promise<void> };

/**
 * Open a pinned transaction and route db.ts through it.
 * Call in `beforeAll`; call the returned `rollback` in `afterAll`.
 */
export async function startTestTransaction(): Promise<TestDatabase> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — see .env.example (TEST_DATABASE_URL).');
  }

  const client = new Client({ connectionString });
  await client.connect();
  await client.query('BEGIN');

  let depth = 0;

  const pinned = {
    async connect() {
      return {
        async query(sql: Sql, params?: unknown[]) {
          const statement = statementOf(sql);

          if (statement === 'BEGIN') {
            depth += 1;
            await client.query(`SAVEPOINT tx_${depth}`);
            // A fresh pooled connection would carry no tenant GUC. Transaction-local
            // settings outlive a RELEASE SAVEPOINT, so clear it to keep the simulated
            // transaction boundary honest — otherwise a systemQuery() following a
            // tenant-scoped query would inherit that tenant's scope in tests only.
            await client.query('SELECT set_config($1, $2, true)', [TENANT_GUC, '']);
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'COMMIT') {
            await client.query(`RELEASE SAVEPOINT tx_${depth}`);
            depth = Math.max(0, depth - 1);
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'ROLLBACK') {
            await client.query(`ROLLBACK TO SAVEPOINT tx_${depth}`);
            await client.query(`RELEASE SAVEPOINT tx_${depth}`);
            depth = Math.max(0, depth - 1);
            return { rows: [], rowCount: 0 };
          }

          return client.query(sql as string, params);
        },
        release() {
          /* the pinned client outlives every borrow */
        },
      };
    },
    async end() {
      /* ownership stays with startTestTransaction */
    },
  };

  __setPoolForTests(pinned as unknown as Pool);

  return {
    async rollback() {
      __setPoolForTests(undefined);
      try {
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    },
  };
}
