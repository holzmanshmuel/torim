/**
 * GET /api/auth/google — start Google sign-in.
 *
 * Mints a CSRF `state`, parks it in the sealed session, and hands the browser to
 * Google. The state has to be written before the redirect, because the callback's only
 * proof that a sign-in really started here is that the sealed cookie already holds the
 * value Google is about to echo back.
 *
 * Accepts `?next=/some/path` so a proxy bounce off a protected page returns the user
 * where they were going. It is laundered through `safeRedirectPath` first — an open
 * redirect on the sign-in route is a phishing primitive, since the victim genuinely
 * did start on our domain.
 *
 * On a deployment with more than one hostname, Google is asked to send the browser
 * back to the host the sign-in started on, because that is the only host holding the
 * cookie with the state — see `resolveOAuthRedirectUri`. The URI chosen is parked in
 * the session too, because the code exchange has to repeat it exactly.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSession, safeRedirectPath } from '@/lib/auth';
import {
  buildGoogleAuthUrl,
  CANONICAL_HOST_HEADER,
  createOAuthState,
  OAuthError,
  resolveOAuthRedirectUri,
} from '@/lib/oauth';
import { redirectToPath } from '@/lib/same-host-redirect';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    const state = createOAuthState();
    session.oauthState = state;

    const requested = safeRedirectPath(request.nextUrl.searchParams.get('next'));
    if (requested) {
      session.postLoginRedirect = requested;
    } else {
      delete session.postLoginRedirect;
    }

    const redirectUri = resolveOAuthRedirectUri(request.headers.get(CANONICAL_HOST_HEADER));
    session.oauthRedirectUri = redirectUri;

    const authorizeUrl = buildGoogleAuthUrl(state, redirectUri);
    await session.save();

    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    // A missing GOOGLE_CLIENT_ID is an operator error, not something to show a shop
    // owner as a stack trace. Log it, bounce them to /login with a flag.
    console.error('[auth] failed to start Google sign-in', err);
    const reason = err instanceof OAuthError ? err.reason : 'signin_failed';
    return redirectToPath(`/login?error=${reason}`);
  }
}
