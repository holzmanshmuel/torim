/**
 * POST /api/auth/signout — destroy the session.
 *
 * POST, not GET, and deliberately so. A GET sign-out can be fired by any `<img>` or
 * link on any site, which is a nuisance rather than a breach but is trivially avoided.
 * The admin UI signs out with a form:
 *
 *   <form action="/api/auth/signout" method="post"><button>Sign out</button></form>
 *
 * `session.destroy()` clears the sealed cookie. There is no server-side session record
 * to revoke — the cookie *is* the session — so this is the whole of signing out.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { redirectToPath } from '@/lib/same-host-redirect';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  session.destroy();
  // 303: turn the POST into a GET for the redirect, so the browser does not re-POST to
  // /login. A relative path, so it stays on the host the user signed out on — see
  // `redirectToPath`.
  return redirectToPath('/login', 303);
}

/** Answering GET would reintroduce exactly the CSRF hole POST-only closes. */
export async function GET() {
  return new NextResponse('Sign out with POST.', {
    status: 405,
    headers: { allow: 'POST' },
  });
}
