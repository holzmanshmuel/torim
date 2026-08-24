/**
 * The proxy allowlist.
 *
 * These assertions exist for one failure mode: gating the public booking flow. A
 * customer arrives from a WhatsApp link with no cookie and no account, and if this file
 * ever stops passing them through, the product is down for the people it exists for
 * while every admin page keeps working and nobody notices.
 */
import { sealData } from 'iron-session';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  classifyPath,
  proxy,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from './proxy';
import * as auth from './lib/auth';

const PASSWORD = 'test-password-at-least-32-characters-long';

async function request(path: string, session?: auth.SessionData): Promise<NextRequest> {
  const headers = new Headers();
  if (session) {
    const sealed = await sealData(session, { password: PASSWORD, ttl: SESSION_TTL_SECONDS });
    headers.set('cookie', `${SESSION_COOKIE_NAME}=${sealed}`);
  }
  return new NextRequest(new URL(path, 'https://torim.test'), { headers });
}

/** Run the proxy with a known session password, restoring the ambient one after. */
async function runProxy(path: string, session?: auth.SessionData) {
  const original = process.env.SESSION_PASSWORD;
  process.env.SESSION_PASSWORD = PASSWORD;
  try {
    return await proxy(await request(path, session));
  } finally {
    if (original === undefined) delete process.env.SESSION_PASSWORD;
    else process.env.SESSION_PASSWORD = original;
  }
}

/**
 * The proxy keeps its own copy of the cookie name and TTL so its bundle does not drag
 * in `pg` and React. This test is what stops the two copies drifting apart — a drift
 * would silently sign every administrator out.
 */
describe('proxy constants', () => {
  it('agree with src/lib/auth.ts', () => {
    expect(SESSION_COOKIE_NAME).toBe(auth.SESSION_COOKIE_NAME);
    expect(SESSION_TTL_SECONDS).toBe(auth.SESSION_TTL_SECONDS);
  });
});

describe('classifyPath', () => {
  it('leaves the public booking flow alone', () => {
    // The booking pages own their own URL shape. Whatever it turns out to be, an
    // unauthenticated customer must reach it.
    for (const path of ['/', '/dina-hair', '/dina-hair/book', '/b/dina-hair/confirm/abc123']) {
      expect(classifyPath(path)).toBe('public');
    }
  });

  it('leaves sign-in, compliance pages and assets alone', () => {
    for (const path of [
      '/login',
      '/login?error=access_denied',
      '/api/auth/google',
      '/api/auth/google/callback',
      '/api/auth/signout',
      '/privacy',
      '/accessibility',
      '/_next/static/chunk.js',
      '/favicon.ico',
    ]) {
      expect(classifyPath(path.split('?')[0])).toBe('public');
    }
  });

  it('leaves the ops endpoints alone — they carry a bearer token, not a cookie', () => {
    expect(classifyPath('/api/ops')).toBe('public');
    expect(classifyPath('/api/ops/due-notifications')).toBe('public');
  });

  it('gates the admin surface', () => {
    for (const path of ['/admin', '/admin/bookings', '/api/admin/services']) {
      expect(classifyPath(path)).toBe('needs-user-and-tenant');
    }
  });

  it('lets onboarding through for a signed-in user with no business', () => {
    expect(classifyPath('/onboarding')).toBe('needs-user');
    expect(classifyPath('/onboarding/business')).toBe('needs-user');
  });

  it('does not confuse a prefix with a path segment', () => {
    // A business whose slug happens to start with "admin" is still a public page.
    expect(classifyPath('/administrators-choice-salon')).toBe('public');
    expect(classifyPath('/loginary')).toBe('public');
  });
});

describe('proxy', () => {
  it('sends an anonymous visitor on an admin page to /login, remembering where', async () => {
    const response = await runProxy('/admin/bookings?day=2026-08-25');
    expect(response.status).toBe(307);

    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/admin/bookings?day=2026-08-25');
  });

  it('answers an unauthenticated admin API call with 401 rather than a redirect', async () => {
    const response = await runProxy('/api/admin/services');
    expect(response.status).toBe(401);
  });

  it('lets an anonymous customer reach a booking page untouched', async () => {
    const response = await runProxy('/dina-hair/book');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('sends a signed-in user with no business to onboarding', async () => {
    const response = await runProxy('/admin', { userId: 'user-1' });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/onboarding');
  });

  it('lets that same user reach onboarding itself', async () => {
    const response = await runProxy('/onboarding', { userId: 'user-1' });
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a fully signed-in administrator through', async () => {
    const response = await runProxy('/admin', { userId: 'user-1', businessId: 'biz-1' });
    expect(response.headers.get('location')).toBeNull();
  });

  it('treats a cookie sealed with someone else’s password as signed out', async () => {
    const forged = await sealData(
      { userId: 'user-1', businessId: 'biz-1' },
      { password: 'an-entirely-different-32-char-password', ttl: SESSION_TTL_SECONDS },
    );
    const headers = new Headers({ cookie: `${SESSION_COOKIE_NAME}=${forged}` });

    const original = process.env.SESSION_PASSWORD;
    process.env.SESSION_PASSWORD = PASSWORD;
    try {
      const response = await proxy(
        new NextRequest(new URL('/admin', 'https://torim.test'), { headers }),
      );
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
    } finally {
      if (original === undefined) delete process.env.SESSION_PASSWORD;
      else process.env.SESSION_PASSWORD = original;
    }
  });

  it('fails closed when SESSION_PASSWORD is missing, without looping', async () => {
    const original = process.env.SESSION_PASSWORD;
    delete process.env.SESSION_PASSWORD;
    try {
      const response = await proxy(await request('/admin', { userId: 'user-1' }));
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
      // /login is public, so the bounce terminates.
      expect(classifyPath('/login')).toBe('public');
    } finally {
      if (original === undefined) delete process.env.SESSION_PASSWORD;
      else process.env.SESSION_PASSWORD = original;
    }
  });
});
