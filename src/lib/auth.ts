/**
 * Admin session and authorization guards.
 *
 * Two rules run through this file, and both exist because the alternative silently
 * fails open:
 *
 *  1. The session cookie is *evidence of sign-in*, never evidence of permission.
 *     `requireAuth()` re-reads the membership from Postgres on every call. The `role`
 *     kept in the cookie is a display convenience (so a nav bar can render without a
 *     round trip) and is never consulted for an access decision. Revoke a membership
 *     in the database and the next request is already locked out.
 *
 *  2. Establishing auth and establishing tenant scope are ONE operation. Every guard
 *     here calls `enterTenant()` before it returns, so there is no window in which a
 *     handler believes it is authenticated but the DB layer has no business id — and
 *     no way for the two to drift onto different businesses.
 *
 * The session password has no default. A guessable fallback would let anyone seal
 * themselves an owner session, so it is read lazily and throws at request time if it
 * is missing or too short — never at import time, which would break `next build`.
 */
import { getIronSession, type IronSession, type SessionOptions } from 'iron-session';
import { systemQueryOne } from './db';
import { enterTenant } from './tenant';

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export const ROLES = ['owner', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Things a signed-in administrator can do. A closed union, so a typo in a guard is a
 * compile error rather than a silent deny that someone later "fixes" by loosening the
 * rule.
 */
export type Action =
  | 'view_schedule'
  | 'manage_bookings'
  | 'manage_customers'
  | 'manage_services'
  | 'manage_working_hours'
  | 'manage_staff'
  | 'manage_settings';

/** What staff may do: run the day. Owner is a strict superset — see `roleAllows`. */
export const STAFF_ACTIONS: readonly Action[] = [
  'view_schedule',
  'manage_bookings',
  'manage_customers',
];

/** Owner-only: anything that reshapes the business itself rather than its day. */
export const OWNER_ONLY_ACTIONS: readonly Action[] = [
  'manage_services',
  'manage_working_hours',
  'manage_staff',
  'manage_settings',
];

const STAFF_SET = new Set<string>(STAFF_ACTIONS);
const OWNER_SET = new Set<string>([...STAFF_ACTIONS, ...OWNER_ONLY_ACTIONS]);

/**
 * Pure permission rule — no session, no database, no request. The whole point is that
 * the policy is unit-testable exhaustively.
 *
 * Unknown roles and unknown actions deny. Deny is the only safe default.
 */
export function roleAllows(role: Role, action: Action): boolean {
  if (role === 'owner') return OWNER_SET.has(action);
  if (role === 'staff') return STAFF_SET.has(action);
  return false;
}

// ---------------------------------------------------------------------------
// Session shape
// ---------------------------------------------------------------------------

export interface SessionData {
  /** torim.users.id. Set once sign-in completes. */
  userId?: string;
  /** The currently active tenant. Absent means "signed in but not onboarded yet". */
  businessId?: string;
  /**
   * Cached membership role. DISPLAY ONLY.
   * Never read this to make an access decision — `requireAuth()` re-reads the live
   * membership. It is here so UI chrome can render without a database round trip.
   */
  role?: Role;
  /** CSRF nonce for the Google OAuth round trip. Cleared as soon as it is consumed. */
  oauthState?: string;
  /** Where to land after sign-in. Same-origin path only — see `safeRedirectPath`. */
  postLoginRedirect?: string;
}

export const SESSION_COOKIE_NAME = 'torim_session';

/** 14 days. Also the seal's own TTL, so an old cookie cannot be replayed forever. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export const MIN_SESSION_PASSWORD_LENGTH = 32;

/**
 * Lazy getter for the seal password.
 *
 * Deliberately NOT evaluated at import time: `next build` imports every module, and a
 * build machine legitimately has no session secret. Deliberately with NO fallback: a
 * default password is a master key that mints owner sessions for anyone who reads the
 * source.
 */
export function getSessionPassword(): string {
  const password = process.env.SESSION_PASSWORD;
  if (!password) {
    throw new Error(
      'SESSION_PASSWORD is not set. Generate one with `openssl rand -base64 32` — there is no default.',
    );
  }
  if (password.length < MIN_SESSION_PASSWORD_LENGTH) {
    throw new Error(
      `SESSION_PASSWORD must be at least ${MIN_SESSION_PASSWORD_LENGTH} characters (got ${password.length}).`,
    );
  }
  return password;
}

/** Built per request, because the password is read per request. */
export function getSessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: getSessionPassword(),
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      // 'lax' and not 'strict': the browser arrives back from Google via a top-level
      // cross-site redirect, and 'strict' would withhold the cookie carrying the state
      // nonce we are about to check.
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS - 60,
    },
  };
}

// ---------------------------------------------------------------------------
// Reading the session
// ---------------------------------------------------------------------------

/** The subset of `next/headers` cookies() that iron-session actually uses. */
export interface SessionCookieStore {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

type CookieStoreResolver = () => Promise<SessionCookieStore>;

let cookieStoreResolver: CookieStoreResolver | null = null;

/**
 * Test seam, matching the `__setPoolForTests` convention in db.ts. Lets a test drive a
 * real sealed session without an HTTP request.
 */
export function __setCookieStoreForTests(resolver: CookieStoreResolver | null): void {
  cookieStoreResolver = resolver;
}

async function resolveCookieStore(): Promise<SessionCookieStore> {
  if (cookieStoreResolver) return cookieStoreResolver();
  // Imported lazily: `next/headers` throws outside a request, and this module is also
  // loaded by unit tests that never make one.
  const { cookies } = await import('next/headers');
  return (await cookies()) as unknown as SessionCookieStore;
}

/**
 * iron-session types its cookie-store parameter with an overloaded `set` — the
 * `set(options)` form it never actually calls on this path. Narrowing the function once,
 * here, keeps `SessionCookieStore` small enough for a test to implement in five lines
 * instead of making every caller satisfy an overload set that is never exercised.
 */
const getIronSessionFromStore = getIronSession as unknown as <T extends object>(
  store: SessionCookieStore,
  options: SessionOptions,
) => Promise<IronSession<T>>;

/**
 * The sealed session for this request. Mutate then `await session.save()` to persist;
 * `session.destroy()` to sign out. Both only work in a Route Handler or Server Action —
 * HTTP will not let a Server Component set cookies mid-render.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await resolveCookieStore();
  return getIronSessionFromStore<SessionData>(store, getSessionOptions());
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * A failed guard. Carries both an HTTP status (for API routes, which want 401/403 JSON)
 * and a redirect target (for pages, which want to send a human somewhere useful):
 *
 *   try { ctx = await requireAuth() }
 *   catch (err) { if (err instanceof AuthError) redirect(err.redirectTo); throw err }
 */
export class AuthError extends Error {
  readonly status: 401 | 403;
  readonly redirectTo: string;

  constructor(message: string, status: 401 | 403, redirectTo: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.redirectTo = redirectTo;
  }
}

export interface AuthContext {
  userId: string;
  businessId: string;
  /** Read live from torim.memberships on this request. Not the cookie's copy. */
  role: Role;
}

/**
 * Verify that `userId` really holds a membership in `businessId` *right now*, then bind
 * the tenant scope for the rest of the request.
 *
 * memberships is not an RLS table and this runs before any tenant context exists, so it
 * is one of the few legitimate `systemQuery` callers.
 */
export async function authorize(userId: string, businessId: string): Promise<AuthContext> {
  const membership = await systemQueryOne<{ role: string }>(
    `SELECT role FROM torim.memberships WHERE user_id = $1 AND business_id = $2`,
    [userId, businessId],
  );

  if (!membership || !isRole(membership.role)) {
    throw new AuthError(
      'No membership for the requested business.',
      403,
      '/login?error=no_membership',
    );
  }

  // Auth and tenant scope are established together, always. Nothing between this line
  // and the caller can observe an authenticated request with no business id, and the
  // id proven here is the id the DB layer will scope to.
  enterTenant(businessId);

  return { userId, businessId, role: membership.role };
}

/**
 * Require a signed-in administrator with an active business, and enter that tenant.
 *
 * Re-reads the membership from the database every call — the cookie's cached role is
 * never trusted, so revoking or demoting a membership takes effect on the next request
 * instead of whenever the cookie happens to expire.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getSession();

  if (!session.userId) {
    throw new AuthError('Not signed in.', 401, '/login');
  }
  if (!session.businessId) {
    throw new AuthError('Signed in with no active business.', 403, '/onboarding');
  }

  return authorize(session.userId, session.businessId);
}

/** Require the owner of the active business. Tenant scope is entered by `requireAuth`. */
export async function requireOwner(): Promise<AuthContext> {
  const context = await requireAuth();
  if (context.role !== 'owner') {
    throw new AuthError('Owner role required.', 403, '/admin?error=owner_only');
  }
  return context;
}

/** Require one capability, using the same pure rules as `roleAllows`. */
export async function requirePermission(action: Action): Promise<AuthContext> {
  const context = await requireAuth();
  if (!roleAllows(context.role, action)) {
    throw new AuthError(`Role "${context.role}" may not ${action}.`, 403, '/admin?error=forbidden');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Redirect hygiene
// ---------------------------------------------------------------------------

/** CR, LF, NUL and friends: header-splitting primitives, never legitimate in a path. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Narrow a caller-supplied `?next=` to a same-origin path, or give up and return null.
 *
 * Rejects absolute URLs, protocol-relative `//evil.com` (which a browser treats as
 * absolute), and backslash variants that some parsers normalise to `/`. An open
 * redirect on a sign-in route is a phishing primitive: the victim really did start on
 * our domain.
 */
export function safeRedirectPath(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//')) return null;
  if (candidate.includes('\\')) return null;
  if (CONTROL_CHARS.test(candidate)) return null;
  return candidate;
}
