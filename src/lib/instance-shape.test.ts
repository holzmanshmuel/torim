/**
 * describeInstance — telling an empty deployment from a single-business one from a
 * shared one.
 *
 * Database-backed rather than mocked, for the same reason the rest of this suite is:
 * the `LIMIT 2` that makes the lookup cheap lives in SQL, and a stub that hands back
 * arrays would prove nothing about the query that actually runs.
 *
 * Every case starts by emptying `torim.businesses`. That is safe here and nowhere
 * else: the whole file runs inside one pinned transaction rolled back in `afterAll`
 * (see test-db.ts), and vitest runs test files one at a time (`fileParallelism: false`
 * in vitest.config.mts), so no other suite has rows in scope to lose.
 *
 * Requires: TEST_DATABASE_URL migrated (`npm run migrate`) and granted (`npm run db:grant`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeInstance } from './businesses';
import { systemQuery } from './db';
import { startTestTransaction, type TestDatabase } from './test-db';

let db: TestDatabase;

async function addBusiness(slug: string, name: string): Promise<void> {
  await systemQuery(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ($1, $2, 'Asia/Jerusalem', 'ILS')`,
    [slug, name],
  );
}

beforeAll(async () => {
  db = await startTestTransaction();
});

afterAll(async () => {
  await db.rollback();
});

beforeEach(async () => {
  await systemQuery('DELETE FROM torim.businesses');
});

describe('describeInstance', () => {
  it('reports an empty instance when no business has been created yet', async () => {
    expect(await describeInstance()).toEqual({ kind: 'empty' });
  });

  it('reports the slug when exactly one business exists', async () => {
    await addBusiness('only-shop', 'The Only Shop');

    expect(await describeInstance()).toEqual({ kind: 'single', slug: 'only-shop' });
  });

  it('reports multi as soon as there is a second business, without naming either', async () => {
    await addBusiness('first-shop', 'First Shop');
    await addBusiness('second-shop', 'Second Shop');

    const shape = await describeInstance();

    expect(shape).toEqual({ kind: 'multi' });
    // The point of the LIMIT 2: no tenant list is ever assembled, so none can leak.
    expect(JSON.stringify(shape)).not.toContain('shop');
  });

  it('still reports multi well past two businesses', async () => {
    for (const slug of ['shop-a', 'shop-b', 'shop-c', 'shop-d', 'shop-e']) {
      await addBusiness(slug, slug);
    }

    expect(await describeInstance()).toEqual({ kind: 'multi' });
  });
});
