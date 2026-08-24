/**
 * Coarse cookie gate. (Next.js 16: `middleware.ts` is deprecated and renamed to
 * `proxy.ts`, exporting `proxy` rather than `middleware`. Same `config.matcher`.)
 *
 * This is a *bouncer*, not the lock. The real check is `requireAuth()` in src/lib/auth.ts,
 * which re-reads the membership from Postgres and enters the tenant scope. All this does
 * is spare a signed-out visitor a round trip to a page that would only bounce them, and
 * push a signed-in-but-not-onboarded user to /onboarding. Nothing here is load-bearing
 * for security, and nothing downstream may assume it ran — Server Functions in
 * particular can bypass a matcher entirely.
 *
 * ── The allowlist is the dangerous part ───────────────────────────────────────
 * Torim's front door is the public booking flow: a customer with a link, no account,
 * no cookie. Gate that by accident and the product is down for the people it exists
 * for, while every admin page keeps working and nobody notices.
 *
 * So this file inverts the usual "deny everything, allow a list" shape. Only the
 * explicitly-named admin surface is gated; everything else — the booking pages, whose
 * URL shape belongs to the booking routes and not to auth — passes through untouched.
 * A new public page therefore cannot be locked out by forgetting to list it here, and
 * a new *protected* page fails safe in the other direction: it is merely unguarded at
 * the proxy, and `requireAuth()` still refuses it.
 *
 * PUBLIC_PREFIXES below is the second line of defence: paths that must work
 * signed-out or pre-tenant even if someone later widens PROTECTED_PREFIXES.
 */
import { unsealData } from 'iron-session';
import { NextResponse, type NextRequest } from 'next/server';
import type { SessionData } from './lib/auth';

/**
 * Kept local rather than imported from ./lib/auth so the proxy bundle does not pull in
 * `pg` and React. src/lib/auth.ts is the source of truth; src/proxy.test.ts asserts
 * these two copies still agree, so the duplication cannot silently drift.
 */
export const SESSION_COOKIE_NAME = 'torim_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

/**
 * Paths that must work with no session at all, or with a session that has no business
 * yet. Every entry is a prefix match on the pathname.
 */
export const PUBLIC_PREFIXES = [
  // Sign-in itself. Gating the OAuth entry or callback is an infinite redirect loop.
  '/api/auth/google',
  '/api/auth/google/callback',
  '/api/auth/signout',
  '/login',

  // Server-to-server. These authenticate with OPS_TOKEN as a bearer header and have no
  // cookie to present; a cookie gate here silently breaks the notification pipeline.
  '/api/ops',

  // Compliance pages. Must be readable by someone who has not signed in and never will.
  '/privacy',
  '/accessibility',

  // Framework and asset paths. Most are excluded by the matcher already; listed so that
  // a matcher change cannot start gating stylesheets.
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
] as const;

/** The admin surface. The ONLY thing this proxy gates. */
export const PROTECTED_PREFIXES = ['/admin', '/api/admin'] as const;

/**
 * Signed in, but no business yet — onboarding is where such a user is *sent*, so it
 * needs a user id and must not itself require one.
 */
export const TENANT_OPTIONAL_PREFIXES = ['/onboarding'] as const;

export type PathClass = 'public' | 'needs-user' | 'needs-user-and-tenant';

function hasPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Pure routing policy, so the allowlist can be tested without a request. */
export function classifyPath(pathname: string): PathClass {
  if (hasPrefix(pathname, PUBLIC_PREFIXES)) return 'public';
  if (hasPrefix(pathname, TENANT_OPTIONAL_PREFIXES)) return 'needs-user';
  if (hasPrefix(pathname, PROTECTED_PREFIXES)) return 'needs-user-and-tenant';
  // Everything else — the public booking pages and the marketing root — is public.
  return 'public';
}

/**
 * Read the sealed session without trusting it for anything but routing.
 *
 * Proxy runs on the Node.js runtime in Next 16, so the same seal the app uses can be
 * opened here. Any failure (no cookie, wrong password, expired seal, tampering) is
 * treated as "signed out" — fail closed, and /login is public so there is no loop.
 */
async function readSession(request: NextRequest): Promise<SessionData | null> {
  const sealed = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sealed) return null;

  const password = process.env.SESSION_PASSWORD;
  if (!password || password.length < 32) return null;

  try {
    return await unsealData<SessionData>(sealed, { password, ttl: SESSION_TTL_SECONDS });
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const pathClass = classifyPath(pathname);

  if (pathClass === 'public') {
    return NextResponse.next();
  }

  const session = await readSession(request);

  if (!session?.userId) {
    // An API client cannot follow a login redirect usefully — tell it the truth.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (pathClass === 'needs-user-and-tenant' && !session.businessId) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'no_active_business' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Run on everything except Next's own static output and the metadata files, then let
   * `classifyPath` decide. Static assets are excluded here as well as in
   * PUBLIC_PREFIXES because unsealing a cookie for every image is pure waste.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
