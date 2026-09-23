/**
 * GET /api/auth/google/callback — finish Google sign-in.
 *
 * Order matters here:
 *   1. Consume the sealed `state` and clear it immediately, so a callback URL cannot be
 *      replayed even if it leaks through a referrer or a shared screen.
 *   2. Validate state, then exchange the code, then read the identity (all in
 *      `completeGoogleSignIn`, which checks state before it touches the network).
 *   3. Upsert the user and choose the active business.
 *   4. Land the user: /admin when they administer something, /onboarding when they do
 *      not yet. A signed-in user with no membership is the normal first-run state, not
 *      an error.
 *
 * The session stores `role` alongside `businessId`, but only so UI chrome can render
 * without a database round trip — `requireAuth()` re-reads the membership on every
 * request and never trusts this copy.
 *
 * Every redirect out of here is a relative path, so the user lands on the host they
 * signed in on — the only host holding the session cookie just written. See
 * `redirectToPath` for why `request.url` cannot be used to build it.
 */
import type { NextRequest } from 'next/server';
import { getSession, safeRedirectPath } from '@/lib/auth';
import { completeGoogleSignIn, OAuthError } from '@/lib/oauth';
import { redirectToPath } from '@/lib/same-host-redirect';
import { getMembershipsForUser, upsertUserByGoogleSub } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** Where a signed-in, onboarded administrator lands by default. */
const DEFAULT_LANDING = '/admin';
/** Where a signed-in user with no business lands. */
const ONBOARDING = '/onboarding';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The user pressed "cancel" on Google's consent screen. Not a failure worth logging.
  const denied = params.get('error');
  if (denied) {
    return redirectToPath('/login?error=access_denied');
  }

  const session = await getSession();

  // One-shot: read them, then drop them whatever happens next.
  const expectedState = session.oauthState;
  const redirectUri = session.oauthRedirectUri;
  delete session.oauthState;
  delete session.oauthRedirectUri;

  try {
    const profile = await completeGoogleSignIn({
      code: params.get('code'),
      state: params.get('state'),
      expectedState,
      redirectUri,
    });

    const user = await upsertUserByGoogleSub({
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name,
    });

    const memberships = await getMembershipsForUser(user.id);

    // Prefer the business they were last in, if they still hold it. Otherwise the
    // first membership, which getMembershipsForUser already sorts owner-first.
    const active =
      memberships.find((membership) => membership.businessId === session.businessId) ??
      memberships[0] ??
      null;

    session.userId = user.id;
    if (active) {
      session.businessId = active.businessId;
      session.role = active.role;
    } else {
      delete session.businessId;
      delete session.role;
    }

    const requested = safeRedirectPath(session.postLoginRedirect);
    delete session.postLoginRedirect;

    await session.save();

    const destination = active ? (requested ?? DEFAULT_LANDING) : ONBOARDING;
    return redirectToPath(destination);
  } catch (err) {
    // Includes the state mismatch, which is the CSRF rejection. Wipe the half-built
    // session rather than leaving a partially-populated one behind.
    console.error('[auth] Google sign-in callback failed', err);
    session.destroy();
    const reason = err instanceof OAuthError ? err.reason : 'signin_failed';
    return redirectToPath(`/login?error=${reason}`);
  }
}
