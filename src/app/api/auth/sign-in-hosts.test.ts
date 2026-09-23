/**
 * Google sign-in on a deployment reachable under two hostnames, driven through the real
 * Route Handlers.
 *
 * The shape being reproduced: a reverse proxy forwards every request to one upstream
 * and reports the browser's hostname in `X-Canonical-Host`. The upstream's own
 * `request.url` names the address the server listens on — `https://localhost:8080`,
 * exactly as a platform router produces it — never either public host. The deployment
 * is configured for `old.example.com` (OAUTH_REDIRECT_URI, APP_BASE_URL) and also
 * answers on `new.example.com`.
 *
 * What must hold:
 *   - a sign-in started on either host comes back to that host, because the cookie
 *     holding the state exists only there;
 *   - the code exchange repeats the redirect URI the sign-in started with;
 *   - every landing after sign-in, sign-in failure and sign-out is a relative path,
 *     never the listen address;
 *   - a forged or missing host header gets OAUTH_REDIRECT_URI, unchanged.
 *
 * The full round trip writes a user row, so it runs inside the rolled-back test
 * transaction like every other DB-backed test (see src/lib/test-db.ts).
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setCookieStoreForTests,
  getSession,
  type SessionCookieStore,
  type SessionData,
} from '@/lib/auth';
import { systemQuery, systemQueryOne } from '@/lib/db';
import { startTestTransaction, type TestDatabase } from '@/lib/test-db';
import { GET as startSignIn } from './google/route';
import { GET as finishSignIn } from './google/callback/route';
import { POST as signOut } from './signout/route';

/** What Next.js hands a Route Handler as request.url behind a platform router. */
const LISTEN_ORIGIN = 'https://localhost:8080';

const OLD_URI = 'https://old.example.com/api/auth/google/callback';
const NEW_URI = 'https://new.example.com/api/auth/google/callback';

const ENV = {
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.test',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_REDIRECT_URI: OLD_URI,
  APP_BASE_URL: 'https://old.example.com',
  SERVER_ACTIONS_ALLOWED_ORIGINS: 'old.example.com,new.example.com',
} as const;

const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

/** One browser's cookie jar for one hostname — the session cookie is host-only. */
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

let jar: SessionCookieStore;

function request(path: string, browserHost?: string, method = 'GET'): NextRequest {
  const headers = new Headers();
  if (browserHost !== undefined) headers.set('x-canonical-host', browserHost);
  return new NextRequest(`${LISTEN_ORIGIN}${path}`, { method, headers });
}

async function sessionNow(): Promise<SessionData> {
  return { ...(await getSession()) };
}

/** Where the start route sent the browser, as a parsed Google authorization URL. */
function googleUrlFrom(response: Response): URL {
  expect(response.status).toBe(307);
  const location = response.headers.get('location');
  expect(location).toMatch(/^https:\/\/accounts\.google\.com\//);
  return new URL(location as string);
}

/** Answers the token exchange and userinfo calls, recording what the exchange sent. */
function fakeGoogle(sub: string): { exchangedRedirectUri: () => string | null } {
  let exchanged: string | null = null;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/token')) {
      exchanged = new URLSearchParams(String(init?.body)).get('redirect_uri');
      return new Response(JSON.stringify({ access_token: 'at-1' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true, name: 'Owner' }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { exchangedRedirectUri: () => exchanged };
}

beforeEach(() => {
  for (const key of Object.keys(ENV)) originalEnv[key] = process.env[key];
  Object.assign(process.env, ENV);
  jar = makeCookieJar();
  __setCookieStoreForTests(async () => jar);
  // The callback logs every refused sign-in on purpose; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __setCookieStoreForTests(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('starting sign-in', () => {
  it('on the second host, asks Google to come back to the second host', async () => {
    const google = googleUrlFrom(await startSignIn(request('/api/auth/google', 'new.example.com')));

    expect(google.searchParams.get('redirect_uri')).toBe(NEW_URI);
    const session = await sessionNow();
    expect(session.oauthRedirectUri).toBe(NEW_URI);
    expect(session.oauthState).toBe(google.searchParams.get('state'));
  });

  it('on the configured host, sends exactly OAUTH_REDIRECT_URI, as before', async () => {
    const google = googleUrlFrom(await startSignIn(request('/api/auth/google', 'old.example.com')));

    expect(google.searchParams.get('redirect_uri')).toBe(OLD_URI);
    expect((await sessionNow()).oauthRedirectUri).toBe(OLD_URI);
  });

  it('with no host header at all, sends OAUTH_REDIRECT_URI', async () => {
    const google = googleUrlFrom(await startSignIn(request('/api/auth/google')));
    expect(google.searchParams.get('redirect_uri')).toBe(OLD_URI);
  });

  /**
   * A client talking to the upstream directly can put anything in the header. A host
   * that is not the deployment's own must never become the place Google delivers the
   * authorization code.
   */
  it('with a forged host header, sends OAUTH_REDIRECT_URI and nothing else', async () => {
    for (const forged of ['evil.example.net', 'new.example.com.evil.example.net', '']) {
      jar = makeCookieJar();
      const google = googleUrlFrom(await startSignIn(request('/api/auth/google', forged)));
      expect(google.searchParams.get('redirect_uri'), forged).toBe(OLD_URI);
      expect((await sessionNow()).oauthRedirectUri, forged).toBe(OLD_URI);
    }
  });

  it('when misconfigured, bounces to /login on the same host, not the listen address', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const response = await startSignIn(request('/api/auth/google', 'new.example.com'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/login?error=misconfigured');
  });
});

describe('finishing sign-in', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestTransaction();
  });

  afterAll(async () => {
    await db.rollback();
  });

  it('on the second host: exchanges with the second-host URI and lands on that host', async () => {
    const google = googleUrlFrom(await startSignIn(request('/api/auth/google', 'new.example.com')));
    const fake = fakeGoogle('second-host-owner');

    const state = google.searchParams.get('state') as string;
    const response = await finishSignIn(
      request(`/api/auth/google/callback?code=good&state=${state}`, 'new.example.com'),
    );

    expect(fake.exchangedRedirectUri()).toBe(NEW_URI);
    // No business yet, so onboarding — as a relative path, on the host the browser is on.
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/onboarding');

    const session = await sessionNow();
    expect(session.userId).toBeTruthy();
    // One-shot: neither survives the callback.
    expect(session.oauthState).toBeUndefined();
    expect(session.oauthRedirectUri).toBeUndefined();
  });

  it('on the configured host: exchanges with OAUTH_REDIRECT_URI exactly', async () => {
    const google = googleUrlFrom(await startSignIn(request('/api/auth/google', 'old.example.com')));
    const fake = fakeGoogle('configured-host-owner');

    const state = google.searchParams.get('state') as string;
    const response = await finishSignIn(
      request(`/api/auth/google/callback?code=good&state=${state}`, 'old.example.com'),
    );

    expect(fake.exchangedRedirectUri()).toBe(OLD_URI);
    expect(response.headers.get('location')).toBe('/onboarding');
  });

  /**
   * A sign-in already in flight when this code is deployed has a state in its session
   * but no recorded redirect URI. It started with OAUTH_REDIRECT_URI, so that is what
   * its exchange must send.
   */
  it('for a sign-in started before the URI was recorded, exchanges with OAUTH_REDIRECT_URI', async () => {
    const seeded = await getSession();
    seeded.oauthState = 'state-from-before';
    await seeded.save();
    const fake = fakeGoogle('in-flight-owner');

    const response = await finishSignIn(
      request('/api/auth/google/callback?code=good&state=state-from-before', 'old.example.com'),
    );

    expect(fake.exchangedRedirectUri()).toBe(OLD_URI);
    expect(response.headers.get('location')).toBe('/onboarding');
  });

  it('sends an existing member to the ?next= path they asked for, still relative', async () => {
    // An owner who already has a business, so the callback has somewhere to send them
    // other than onboarding.
    const user = await systemQueryOne<{ id: string }>(
      `INSERT INTO torim.users (google_sub, email, name) VALUES ($1, $2, 'Owner') RETURNING id`,
      ['returning-owner', 'returning-owner@example.test'],
    );
    const business = await systemQueryOne<{ id: string }>(
      `INSERT INTO torim.businesses (slug, name, timezone, currency)
       VALUES ('sign-in-hosts-shop', 'Shop', 'Asia/Jerusalem', 'ILS') RETURNING id`,
    );
    await systemQuery(
      `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'owner')`,
      [user?.id, business?.id],
    );

    const google = googleUrlFrom(
      await startSignIn(request('/api/auth/google?next=%2Fadmin%2Fweek', 'new.example.com')),
    );
    fakeGoogle('returning-owner');

    const state = google.searchParams.get('state') as string;
    const response = await finishSignIn(
      request(`/api/auth/google/callback?code=good&state=${state}`, 'new.example.com'),
    );

    expect(response.headers.get('location')).toBe('/admin/week');
    expect((await sessionNow()).businessId).toBe(business?.id);
  });

  it('refuses a callback whose state is not in this host’s cookie, landing on /login here', async () => {
    // The browser started on one host and came back to another: this jar never saw it.
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const response = await finishSignIn(
      request('/api/auth/google/callback?code=good&state=from-another-host', 'old.example.com'),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/login?error=state_missing');
  });

  it('when the user cancels at Google, lands on /login on the same host', async () => {
    const response = await finishSignIn(
      request('/api/auth/google/callback?error=access_denied', 'new.example.com'),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/login?error=access_denied');
  });
});

describe('signing out', () => {
  it('303s to /login on the same host, not the listen address', async () => {
    const response = await signOut();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });
});
