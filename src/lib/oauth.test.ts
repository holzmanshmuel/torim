/**
 * Google OAuth.
 *
 * No network here: the only thing worth asserting about a hand-rolled OAuth client is
 * the part an attacker touches — the `state` check — and that it happens *before* we
 * spend a request on Google.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildGoogleAuthUrl,
  completeGoogleSignIn,
  createOAuthState,
  getGoogleClientId,
  OAuthError,
  resolveOAuthRedirectUri,
  verifyState,
} from './oauth';

const ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OAUTH_REDIRECT_URI',
  'APP_BASE_URL',
  'SERVER_ACTIONS_ALLOWED_ORIGINS',
] as const;

const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.test';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
  delete process.env.APP_BASE_URL;
  delete process.env.SERVER_ACTIONS_ALLOWED_ORIGINS;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

describe('createOAuthState', () => {
  it('produces a long, url-safe, non-repeating nonce', () => {
    const a = createOAuthState();
    const b = createOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildGoogleAuthUrl', () => {
  it('carries the state and the registered redirect URI', () => {
    const url = new URL(buildGoogleAuthUrl('state-abc'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.test');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('sends the redirect URI it is given instead, when there is one', () => {
    const url = new URL(
      buildGoogleAuthUrl('state-abc', 'https://new.example.com/api/auth/google/callback'),
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://new.example.com/api/auth/google/callback',
    );
  });

  it('throws a recoverable error when the client id is not configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => getGoogleClientId()).toThrow(OAuthError);
    expect(() => buildGoogleAuthUrl('state-abc')).toThrow(/GOOGLE_CLIENT_ID is not set/);
  });
});

describe('verifyState', () => {
  it('accepts a state that matches the sealed one', () => {
    expect(() => verifyState('nonce-123', 'nonce-123')).not.toThrow();
  });

  it('rejects a mismatch', () => {
    expect(() => verifyState('nonce-123', 'nonce-456')).toThrow(/state mismatch/i);
  });

  it('rejects a same-length near-miss', () => {
    expect(() => verifyState('nonce-123', 'nonce-124')).toThrow(/state mismatch/i);
  });

  it('rejects a callback with no state in the session', () => {
    expect(() => verifyState(undefined, 'nonce-123')).toThrow(/No OAuth state in session/);
  });

  it('rejects a callback that returns no state', () => {
    expect(() => verifyState('nonce-123', null)).toThrow(/did not return an OAuth state/);
  });

  it('rejects an empty state on either side', () => {
    expect(() => verifyState('', 'anything')).toThrow(OAuthError);
    expect(() => verifyState('nonce-123', '')).toThrow(OAuthError);
  });
});

describe('completeGoogleSignIn', () => {
  it('rejects a state mismatch before spending a request on Google', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      completeGoogleSignIn({
        code: 'attacker-supplied-code',
        state: 'attacker-state',
        expectedState: 'sealed-state',
      }),
    ).rejects.toThrow(/state mismatch/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a missing code once the state has checked out', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      completeGoogleSignIn({ code: null, state: 'sealed-state', expectedState: 'sealed-state' }),
    ).rejects.toThrow(/authorization code/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the verified identity on the happy path', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ access_token: 'at-1', token_type: 'Bearer' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          sub: '1234567890',
          email: 'Owner@Example.Test',
          email_verified: true,
          name: '  Shop Owner  ',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const profile = await completeGoogleSignIn({
      code: 'good-code',
      state: 'sealed-state',
      expectedState: 'sealed-state',
    });

    expect(profile).toEqual({ sub: '1234567890', email: 'owner@example.test', name: 'Shop Owner' });
  });

  it('refuses an address Google explicitly reports as unverified', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/token')) {
        return new Response(JSON.stringify({ access_token: 'at-1' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ sub: 'abc', email: 'nope@example.test', email_verified: false }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await expect(
      completeGoogleSignIn({ code: 'c', state: 's', expectedState: 's' }),
    ).rejects.toThrow(/unverified/);
  });

  it('does not leak Google’s error body when the exchange fails', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', client_id: 'secret-ish' }), {
          status: 400,
        }),
    ) as unknown as typeof fetch;

    await expect(
      completeGoogleSignIn({ code: 'c', state: 's', expectedState: 's' }),
    ).rejects.toThrow(/Google token exchange failed \(400\)/);
  });
});

/**
 * Which redirect URI a sign-in gets, depending on the host the browser used.
 *
 * The deployment below answers on two names — `old.example.com`, its configured
 * address, and `new.example.com` — with the configured OAUTH_REDIRECT_URI still on
 * the old one. The host argument is the proxy's report of the browser's host, which a
 * client talking to the origin directly can set to anything; everything off the
 * allowlist must come back as OAUTH_REDIRECT_URI, unchanged.
 */
describe('resolveOAuthRedirectUri', () => {
  const OLD_URI = 'https://old.example.com/api/auth/google/callback';
  const NEW_URI = 'https://new.example.com/api/auth/google/callback';

  beforeEach(() => {
    process.env.OAUTH_REDIRECT_URI = OLD_URI;
    process.env.APP_BASE_URL = 'https://old.example.com';
    process.env.SERVER_ACTIONS_ALLOWED_ORIGINS = 'old.example.com,new.example.com';
  });

  it('sends a sign-in on an allowed second host back to that host, same path', () => {
    expect(resolveOAuthRedirectUri('new.example.com')).toBe(NEW_URI);
  });

  it('matches the host case-insensitively and ignores surrounding space', () => {
    expect(resolveOAuthRedirectUri(' New.Example.COM ')).toBe(NEW_URI);
  });

  it('gives the configured host exactly the configured string', () => {
    expect(resolveOAuthRedirectUri('old.example.com')).toBe(OLD_URI);
  });

  it('falls back to the configured URI when there is no host to go on', () => {
    expect(resolveOAuthRedirectUri(null)).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri(undefined)).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri('')).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri('   ')).toBe(OLD_URI);
  });

  /**
   * The open-redirect / code-theft case. If a forged host could become the redirect
   * URI, Google would deliver the authorization code to it. Every one of these must
   * be refused and fall back — not rewritten, not partially matched.
   */
  it('never uses a host that is not on the allowlist', () => {
    const forged = [
      'evil.example.net',
      'new.example.com.evil.example.net',
      'evil.example.net/new.example.com',
      'new.example.com@evil.example.net',
      'new.example.com, evil.example.net',
      'evil.example.net, new.example.com',
      'new.example.com:8443',
      'example.com',
      'localhost:3000',
    ];
    for (const host of forged) {
      expect(resolveOAuthRedirectUri(host), host).toBe(OLD_URI);
    }
  });

  it('never matches a wildcard entry, even one written into the header verbatim', () => {
    process.env.SERVER_ACTIONS_ALLOWED_ORIGINS = 'old.example.com,*.example.com';
    expect(resolveOAuthRedirectUri('*.example.com')).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri('new.example.com')).toBe(OLD_URI);
  });

  /**
   * The deployment as it is before anyone sets the new variable: nothing but the
   * configured host is allowed, so every sign-in gets the configured URI — the
   * behaviour this function did not exist to change.
   */
  it('changes nothing for a deployment that has not listed a second host', () => {
    delete process.env.SERVER_ACTIONS_ALLOWED_ORIGINS;
    expect(resolveOAuthRedirectUri('new.example.com')).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri('old.example.com')).toBe(OLD_URI);

    delete process.env.APP_BASE_URL;
    expect(resolveOAuthRedirectUri('old.example.com')).toBe(OLD_URI);
  });

  it('treats an empty SERVER_ACTIONS_ALLOWED_ORIGINS exactly like an unset one', () => {
    process.env.SERVER_ACTIONS_ALLOWED_ORIGINS = '';
    expect(resolveOAuthRedirectUri('new.example.com')).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri('old.example.com')).toBe(OLD_URI);
  });

  /**
   * Later, the configured address moves to the new name. The old one stays listed so
   * bookmarks keep working, and its sign-ins must still come back to it.
   */
  it('keeps the old host working once the configuration moves to the new one', () => {
    process.env.OAUTH_REDIRECT_URI = NEW_URI;
    process.env.APP_BASE_URL = 'https://new.example.com';
    expect(resolveOAuthRedirectUri('new.example.com')).toBe(NEW_URI);
    expect(resolveOAuthRedirectUri('old.example.com')).toBe(OLD_URI);
    expect(resolveOAuthRedirectUri('evil.example.net')).toBe(NEW_URI);
  });

  it('keeps the scheme, port rules and path of the configured URI', () => {
    process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.SERVER_ACTIONS_ALLOWED_ORIGINS = 'localhost:3001';
    expect(resolveOAuthRedirectUri('localhost:3001')).toBe(
      'http://localhost:3001/api/auth/google/callback',
    );
  });

  it('still refuses to run without OAUTH_REDIRECT_URI, whatever the host', () => {
    delete process.env.OAUTH_REDIRECT_URI;
    expect(() => resolveOAuthRedirectUri('new.example.com')).toThrow(OAuthError);
    expect(() => resolveOAuthRedirectUri(null)).toThrow(/OAUTH_REDIRECT_URI is not set/);
  });
});

/**
 * Google refuses a code exchange whose redirect_uri differs from the authorization
 * request's, so the exchange has to send exactly the URI the sign-in started with.
 */
describe('completeGoogleSignIn — redirect URI on the code exchange', () => {
  function captureTokenExchange(): { redirectUri: () => string | null } {
    let sent: string | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/token')) {
        sent = new URLSearchParams(String(init?.body)).get('redirect_uri');
        return new Response(JSON.stringify({ access_token: 'at-1' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ sub: 's-1', email: 'o@example.test' }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { redirectUri: () => sent };
  }

  it('sends the redirect URI the sign-in started with', async () => {
    const exchange = captureTokenExchange();
    await completeGoogleSignIn({
      code: 'c',
      state: 's',
      expectedState: 's',
      redirectUri: 'https://new.example.com/api/auth/google/callback',
    });
    expect(exchange.redirectUri()).toBe('https://new.example.com/api/auth/google/callback');
  });

  it('falls back to OAUTH_REDIRECT_URI for a sign-in that did not record one', async () => {
    const exchange = captureTokenExchange();
    await completeGoogleSignIn({ code: 'c', state: 's', expectedState: 's' });
    expect(exchange.redirectUri()).toBe('http://localhost:3000/api/auth/google/callback');
  });
});
