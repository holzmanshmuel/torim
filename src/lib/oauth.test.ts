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
  verifyState,
} from './oauth';

const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_URI'] as const;

const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.test';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
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
