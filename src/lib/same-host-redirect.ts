/**
 * Redirect to a path on whichever host the browser is already on.
 *
 * ── Why not `NextResponse.redirect(new URL(path, request.url))` ──────────────
 * In a Route Handler, `request.url` is not the address the browser used. Next.js
 * builds it from the hostname and port the server LISTENS on, not from the Host
 * header — so behind any reverse proxy or platform router it reads something like
 * `https://localhost:8080/api/auth/google/callback`, and a redirect built on it sends
 * the browser to `https://localhost:8080/admin`. (Redirects from `src/proxy.ts` do not
 * have this problem: Next rewrites those to a relative Location on the way out. Route
 * Handler responses are passed through as written.)
 *
 * A relative Location sidesteps the question entirely. The browser resolves it against
 * the URL it just requested, so the user stays on the host they were on — whichever of
 * a deployment's hostnames that is — without the server trusting any header to find
 * out. RFC 9110 permits a relative Location, and every browser follows one.
 *
 * Signing in is the flow this matters for: the session cookie is host-only, so a user
 * who signs in on one hostname and lands on another arrives signed out.
 */
import { NextResponse } from 'next/server';
import { safeRedirectPath } from './auth';

/**
 * @param path a same-origin path, optionally with a query string. Anything else
 *   (an absolute URL, `//host`, backslashes, control characters) throws: every caller
 *   passes a constant or a path already laundered through `safeRedirectPath`, so a
 *   value that fails here is a bug to surface, not input to repair.
 * @param status 307 by default, like `NextResponse.redirect`; 303 to turn a POST into a
 *   GET.
 */
export function redirectToPath(path: string, status: 303 | 307 = 307): NextResponse {
  if (safeRedirectPath(path) !== path) {
    throw new Error(`redirectToPath takes a same-origin path; got "${path}".`);
  }
  return new NextResponse(null, { status, headers: { location: path } });
}
