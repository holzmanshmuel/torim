/**
 * Session, permission rules and guards.
 *
 * The permission table and the redirect hygiene are pure and tested exhaustively. The
 * guards are tested against a real Postgres, because the claim being made — "the cookie
 * is never trusted, the membership is re-read" — is only meaningful if a real row
 * disappearing really does lock the session out.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setCookieStoreForTests,
  AuthError,
  getSession,
  getSessionPassword,
  OWNER_ONLY_ACTIONS,
  requireAuth,
  requireOwner,
  requirePermission,
  roleAllows,
  safeRedirectPath,
  STAFF_ACTIONS,
  type Action,
  type Role,
  type SessionCookieStore,
} from './auth';
import { systemQuery, systemQueryOne } from './db';
import {
  __resetRequestHolderResolver,
  __setRequestHolderResolver,
  getBusinessId,
  type RequestHolder,
} from './tenant';
import { startTestTransaction, type TestDatabase } from './test-db';

// ---------------------------------------------------------------------------
// Pure rules — no database, no request
// ---------------------------------------------------------------------------

const ALL_ACTIONS: readonly Action[] = [...STAFF_ACTIONS, ...OWNER_ONLY_ACTIONS];

describe('roleAllows', () => {
  it('lets owner do everything', () => {
    for (const action of ALL_ACTIONS) {
      expect(roleAllows('owner', action)).toBe(true);
    }
  });

  it('lets staff run the day but not reshape the business', () => {
    const table = ALL_ACTIONS.map((action) => [action, roleAllows('staff', action)] as const);
    expect(Object.fromEntries(table)).toEqual({
      view_schedule: true,
      manage_bookings: true,
      manage_customers: true,
      manage_services: false,
      manage_working_hours: false,
      manage_staff: false,
      manage_settings: false,
    });
  });

  it('makes owner a strict superset of staff', () => {
    for (const action of STAFF_ACTIONS) {
      expect(roleAllows('staff', action)).toBe(true);
      expect(roleAllows('owner', action)).toBe(true);
    }
    for (const action of OWNER_ONLY_ACTIONS) {
      expect(roleAllows('staff', action)).toBe(false);
      expect(roleAllows('owner', action)).toBe(true);
    }
  });

  it('denies unknown roles and unknown actions', () => {
    expect(roleAllows('superuser' as Role, 'view_schedule')).toBe(false);
    expect(roleAllows('' as Role, 'view_schedule')).toBe(false);
    expect(roleAllows('owner', 'drop_database' as Action)).toBe(false);
    expect(roleAllows('staff', 'drop_database' as Action)).toBe(false);
  });
});

describe('safeRedirectPath', () => {
  it('accepts same-origin paths', () => {
    expect(safeRedirectPath('/admin')).toBe('/admin');
    expect(safeRedirectPath('/admin/bookings?day=2026-08-25')).toBe(
      '/admin/bookings?day=2026-08-25',
    );
  });

  it('refuses anything that could leave the origin', () => {
    expect(safeRedirectPath('https://evil.example/steal')).toBeNull();
    expect(safeRedirectPath('//evil.example/steal')).toBeNull();
    expect(safeRedirectPath('/\\evil.example')).toBeNull();
    expect(safeRedirectPath('admin')).toBeNull();
    expect(safeRedirectPath('/admin\nLocation: https://evil.example')).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The session password
// ---------------------------------------------------------------------------

describe('session password', () => {
  const original = process.env.SESSION_PASSWORD;

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_PASSWORD;
    else process.env.SESSION_PASSWORD = original;
  });

  it('returns the configured password', () => {
    process.env.SESSION_PASSWORD = 'x'.repeat(32);
    expect(getSessionPassword()).toBe('x'.repeat(32));
  });

  it('throws when it is missing, rather than falling back to a default', () => {
    delete process.env.SESSION_PASSWORD;
    expect(() => getSessionPassword()).toThrow(/SESSION_PASSWORD is not set/);
  });

  it('throws when it is too short to seal with', () => {
    process.env.SESSION_PASSWORD = 'short';
    expect(() => getSessionPassword()).toThrow(/at least 32 characters/);
  });

  /**
   * `next build` imports every module on a machine that legitimately has no session
   * secret. Reading the env var at module scope would turn a missing secret into a
   * broken build instead of a loud runtime error on the first request.
   */
  it('is read lazily — importing the module with no password does not throw', async () => {
    delete process.env.SESSION_PASSWORD;
    vi.resetModules();

    const fresh = await import('./auth');

    expect(typeof fresh.getSessionPassword).toBe('function');
    expect(() => fresh.getSessionPassword()).toThrow(/SESSION_PASSWORD is not set/);

    vi.resetModules();
  });
});

// ---------------------------------------------------------------------------
// Guards, against a real database
// ---------------------------------------------------------------------------

/** A cookie jar that behaves like the `next/headers` store iron-session expects. */
function makeCookieJar(): SessionCookieStore {
  const jar = new Map<string, string>();
  return {
    get(name) {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value) {
      jar.set(name, value);
    },
  };
}

/** Seal a real session into a fresh jar and point getSession() at it. */
async function signIn(data: { userId?: string; businessId?: string; role?: Role }): Promise<void> {
  const jar = makeCookieJar();
  __setCookieStoreForTests(async () => jar);
  const session = await getSession();
  Object.assign(session, data);
  await session.save();
}

let db: TestDatabase;
let userId: string;
let strangerId: string;
let businessId: string;
let otherBusinessId: string;

async function makeUser(sub: string, email: string): Promise<string> {
  const row = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.users (google_sub, email, name) VALUES ($1, $2, $3) RETURNING id`,
    [sub, email, 'Test Person'],
  );
  if (!row) throw new Error('user insert returned nothing');
  return row.id;
}

async function makeBusiness(slug: string): Promise<string> {
  const row = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ($1, $2, 'Asia/Jerusalem', 'ILS') RETURNING id`,
    [slug, slug],
  );
  if (!row) throw new Error('business insert returned nothing');
  return row.id;
}

beforeAll(async () => {
  db = await startTestTransaction();
  userId = await makeUser('auth-test-sub-1', 'owner@example.test');
  strangerId = await makeUser('auth-test-sub-2', 'stranger@example.test');
  businessId = await makeBusiness('auth-test-a');
  otherBusinessId = await makeBusiness('auth-test-b');
});

afterAll(async () => {
  await db.rollback();
  __setCookieStoreForTests(null);
  __resetRequestHolderResolver();
});

describe('requireAuth', () => {
  let holder: RequestHolder;

  beforeEach(() => {
    // A fresh request-scoped holder per test, so "did the guard enter the tenant?" is
    // observable the same way it is inside a real request.
    holder = { businessId: null };
    __setRequestHolderResolver(() => holder);
  });

  afterEach(async () => {
    __setCookieStoreForTests(null);
    __resetRequestHolderResolver();
    await systemQuery(`DELETE FROM torim.memberships WHERE user_id IN ($1, $2)`, [
      userId,
      strangerId,
    ]);
  });

  it('rejects a request with no session at all', async () => {
    await signIn({});
    await expect(requireAuth()).rejects.toBeInstanceOf(AuthError);
    await expect(requireAuth()).rejects.toMatchObject({ status: 401, redirectTo: '/login' });
    expect(holder.businessId).toBeNull();
  });

  it('sends a signed-in user with no active business to onboarding', async () => {
    await signIn({ userId });
    await expect(requireAuth()).rejects.toMatchObject({
      status: 403,
      redirectTo: '/onboarding',
    });
    expect(holder.businessId).toBeNull();
  });

  /**
   * The core claim. The cookie is perfectly valid and self-consistent — it was sealed
   * by us and says this user administers this business. There is simply no membership
   * row. A cookie-trusting guard would let it straight through.
   */
  it('rejects a user with no membership for the requested business', async () => {
    await signIn({ userId, businessId, role: 'owner' });

    await expect(requireAuth()).rejects.toThrow(/No membership/);
    await expect(requireAuth()).rejects.toMatchObject({ status: 403 });
    expect(holder.businessId).toBeNull();
  });

  it('rejects a membership in a different business', async () => {
    await systemQuery(
      `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'owner')`,
      [userId, otherBusinessId],
    );
    await signIn({ userId, businessId, role: 'owner' });

    await expect(requireAuth()).rejects.toMatchObject({ status: 403 });
    expect(holder.businessId).toBeNull();
  });

  it('accepts a live membership and enters the tenant in the same call', async () => {
    await systemQuery(
      `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'owner')`,
      [userId, businessId],
    );
    await signIn({ userId, businessId, role: 'owner' });

    const context = await requireAuth();

    expect(context).toEqual({ userId, businessId, role: 'owner' });
    // The whole point of doing both in one call: the DB layer is already scoped.
    expect(getBusinessId()).toBe(businessId);
    expect(holder.businessId).toBe(businessId);
  });

  /** The cookie says owner. The database says staff. The database wins. */
  it('ignores the role cached in the cookie', async () => {
    await systemQuery(
      `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'staff')`,
      [userId, businessId],
    );
    await signIn({ userId, businessId, role: 'owner' });

    const context = await requireAuth();
    expect(context.role).toBe('staff');

    await expect(requireOwner()).rejects.toMatchObject({ status: 403 });
    await expect(requirePermission('manage_services')).rejects.toMatchObject({ status: 403 });
    await expect(requirePermission('manage_bookings')).resolves.toMatchObject({ role: 'staff' });
  });

  it('lets an owner through requireOwner, tenant already entered', async () => {
    await systemQuery(
      `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'owner')`,
      [userId, businessId],
    );
    await signIn({ userId, businessId, role: 'staff' });

    const context = await requireOwner();
    expect(context.role).toBe('owner');
    expect(getBusinessId()).toBe(businessId);
  });
});
