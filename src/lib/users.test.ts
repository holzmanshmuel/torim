/**
 * The pre-tenant reads and writes, against a real Postgres.
 *
 * Worth doing for real rather than mocking: `createBusinessWithOwner` calls a
 * SECURITY DEFINER function whose EXECUTE grant lives in a migration script, and a
 * missing grant is invisible until the first person ever tries to onboard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemQuery, systemQueryOne } from './db';
import { startTestTransaction, type TestDatabase } from './test-db';
import {
  createBusinessWithOwner,
  getMembership,
  getMembershipsForUser,
  upsertUserByGoogleSub,
} from './users';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestTransaction();
});

afterAll(async () => {
  await db.rollback();
});

describe('upsertUserByGoogleSub', () => {
  it('creates a user on first sign-in', async () => {
    const user = await upsertUserByGoogleSub({
      googleSub: 'users-test-new',
      email: 'new@example.test',
      name: 'New Person',
    });

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user).toMatchObject({
      googleSub: 'users-test-new',
      email: 'new@example.test',
      name: 'New Person',
    });
  });

  /**
   * Keyed on Google's `sub`, not the email address. An address can change hands; if it
   * were the key, whoever inherits it would inherit the business.
   */
  it('returns the same row when the email address changes', async () => {
    const first = await upsertUserByGoogleSub({
      googleSub: 'users-test-stable',
      email: 'before@example.test',
      name: 'Same Person',
    });
    const second = await upsertUserByGoogleSub({
      googleSub: 'users-test-stable',
      email: 'after@example.test',
      name: 'Same Person',
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe('after@example.test');

    const count = await systemQuery(`SELECT id FROM torim.users WHERE google_sub = $1`, [
      'users-test-stable',
    ]);
    expect(count).toHaveLength(1);
  });

  it('does not blank a stored name that Google stops returning', async () => {
    await upsertUserByGoogleSub({
      googleSub: 'users-test-name',
      email: 'named@example.test',
      name: 'Has A Name',
    });
    const again = await upsertUserByGoogleSub({
      googleSub: 'users-test-name',
      email: 'named@example.test',
      name: null,
    });

    expect(again.name).toBe('Has A Name');
  });
});

describe('createBusinessWithOwner', () => {
  it('creates the business and the owner membership in one call', async () => {
    const user = await upsertUserByGoogleSub({
      googleSub: 'users-test-owner',
      email: 'owner@example.test',
    });

    const businessId = await createBusinessWithOwner({
      userId: user.id,
      slug: 'users-test-salon',
      name: 'Users Test Salon',
      timezone: 'Asia/Jerusalem',
      currency: 'ILS',
    });

    const business = await systemQueryOne<{ slug: string; timezone: string }>(
      `SELECT slug, timezone FROM torim.businesses WHERE id = $1`,
      [businessId],
    );
    expect(business).toMatchObject({ slug: 'users-test-salon', timezone: 'Asia/Jerusalem' });

    const membership = await getMembership(user.id, businessId);
    expect(membership).toMatchObject({ role: 'owner', slug: 'users-test-salon' });
  });

  it('refuses a duplicate slug rather than creating a second business', async () => {
    const user = await upsertUserByGoogleSub({
      googleSub: 'users-test-dupe',
      email: 'dupe@example.test',
    });

    await createBusinessWithOwner({
      userId: user.id,
      slug: 'users-test-taken',
      name: 'First',
      timezone: 'Asia/Jerusalem',
      currency: 'ILS',
    });

    await expect(
      createBusinessWithOwner({
        userId: user.id,
        slug: 'users-test-taken',
        name: 'Second',
        timezone: 'Asia/Jerusalem',
        currency: 'ILS',
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('getMembershipsForUser', () => {
  it('returns nothing for a user who has not onboarded', async () => {
    const user = await upsertUserByGoogleSub({
      googleSub: 'users-test-fresh',
      email: 'fresh@example.test',
    });
    expect(await getMembershipsForUser(user.id)).toEqual([]);
    expect(await getMembership(user.id, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  /**
   * The sign-in callback lands the user in `[0]`. Putting a business they merely staff
   * ahead of one they own would look like their own shop had lost its settings.
   */
  it('puts businesses the user owns first', async () => {
    const user = await upsertUserByGoogleSub({
      googleSub: 'users-test-multi',
      email: 'multi@example.test',
    });

    const owned = await createBusinessWithOwner({
      userId: user.id,
      slug: 'users-test-owned',
      name: 'Zebra Salon', // sorts last alphabetically, so ordering by role must win
      timezone: 'Asia/Jerusalem',
      currency: 'ILS',
    });

    const staffed = await systemQueryOne<{ id: string }>(
      `INSERT INTO torim.businesses (slug, name, timezone, currency)
       VALUES ('users-test-staffed', 'Alpha Barbers', 'Asia/Jerusalem', 'ILS') RETURNING id`,
    );
    if (!staffed) throw new Error('business insert returned nothing');
    await systemQuery(
      `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'staff')`,
      [user.id, staffed.id],
    );

    const memberships = await getMembershipsForUser(user.id);
    expect(memberships.map((m) => [m.businessId, m.role])).toEqual([
      [owned, 'owner'],
      [staffed.id, 'staff'],
    ]);
  });
});
