/**
 * Google OAuth 2.0, hand-rolled.
 *
 * Deliberately not NextAuth/Auth.js. The whole requirement is "let the owner sign in
 * with Google": one provider, one flow, three HTTP calls. A framework here would add a
 * dependency with its own session model that would then fight the sealed session in
 * auth.ts and the tenant binding in tenant.ts.
 *
 * The flow, and where each guarantee comes from:
 *   1. /api/auth/google mints a random `state`, stores it in the sealed session, and
 *      sends the browser to Google.
 *   2. Google redirects back with `code` + `state`.
 *   3. `verifyState` compares the returned `state` to the sealed one. This is the CSRF
 *      defence: an attacker can make a victim's browser hit our callback, but cannot
 *      write the victim's sealed cookie, so they cannot produce a matching state.
 *   4. The `code` is exchanged server-to-server (client secret never leaves the server),
 *      and the resulting access token is used to read the userinfo.
 *
 * Every environment read is lazy and throws at request time. Nothing here is evaluated
 * at import time, so a build machine with no Google credentials still builds.
 */

/** Where the browser is sent to consent. */
const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Server-to-server code exchange. */
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** OIDC userinfo. Returns `sub`, `email`, `email_verified`, `name`. */
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Identity only. We never ask for calendar or contacts here. */
const GOOGLE_SCOPES = ['openid', 'email', 'profile'];

/** A recoverable sign-in failure. Routes turn this into a redirect, never a 500 page. */
export class OAuthError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.reason = reason;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new OAuthError('misconfigured', `${name} is not set. Google sign-in cannot run.`);
  }
  return value;
}

export function getGoogleClientId(): string {
  return requireEnv('GOOGLE_CLIENT_ID');
}

export function getGoogleClientSecret(): string {
  return requireEnv('GOOGLE_CLIENT_SECRET');
}

/**
 * Must match the redirect URI registered in Google Cloud byte for byte, which is why it
 * is configuration and never derived from the incoming request.
 */
export function getOAuthRedirectUri(): string {
  return requireEnv('OAUTH_REDIRECT_URI');
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** 256 bits of CSPRNG, url-safe. */
export function createOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Constant-time comparison of the returned state against the sealed one.
 *
 * Length is compared first and non-secretly — it is not the secret, and
 * `timingSafeEqual` throws on a length mismatch.
 */
export function verifyState(expected: string | undefined, received: string | null | undefined): void {
  if (!expected) {
    throw new OAuthError('state_missing', 'No OAuth state in session. Start sign-in again.');
  }
  if (!received) {
    throw new OAuthError('state_missing', 'Google did not return an OAuth state.');
  }

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new OAuthError('state_mismatch', 'OAuth state mismatch — refusing to sign in.');
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Step 1 — the authorization URL
// ---------------------------------------------------------------------------

export function buildGoogleAuthUrl(state: string): string {
  const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', getGoogleClientId());
  url.searchParams.set('redirect_uri', getOAuthRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', state);
  // No refresh token: we never act on the user's behalf offline, so asking for one
  // would be storing a credential we have no use for.
  url.searchParams.set('access_type', 'online');
  // A shop owner and their staff often share a machine; make the account explicit.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

// ---------------------------------------------------------------------------
// Step 2 — code exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getOAuthRedirectUri(),
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    // The body echoes the code and can echo the client_id; never surface it to a user.
    throw new OAuthError('token_exchange_failed', `Google token exchange failed (${response.status}).`);
  }

  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) {
    throw new OAuthError('token_exchange_failed', 'Google token response had no access_token.');
  }
  return token.access_token;
}

// ---------------------------------------------------------------------------
// Step 3 — who signed in
// ---------------------------------------------------------------------------

export interface GoogleProfile {
  /** Google's stable per-account id. The join key — an email address is not, it moves. */
  sub: string;
  email: string;
  name: string | null;
}

interface UserinfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new OAuthError('userinfo_failed', `Google userinfo failed (${response.status}).`);
  }

  const profile = (await response.json()) as UserinfoResponse;

  if (!profile.sub) {
    throw new OAuthError('userinfo_failed', 'Google userinfo had no subject.');
  }
  if (!profile.email) {
    throw new OAuthError('userinfo_failed', 'Google userinfo had no email address.');
  }
  // Only reject an explicit false. Absent means Google did not assert either way, and
  // treating that as unverified would lock out otherwise valid Workspace accounts.
  if (profile.email_verified === false) {
    throw new OAuthError('email_unverified', 'Google reports this email address as unverified.');
  }

  return {
    sub: profile.sub,
    email: profile.email.toLowerCase(),
    name: profile.name?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// The whole callback half, in one call
// ---------------------------------------------------------------------------

/**
 * Validate the state, exchange the code, and return the verified identity.
 *
 * State is checked FIRST, before any network call, so a forged callback costs us
 * nothing and can never reach Google with an attacker-chosen code.
 */
export async function completeGoogleSignIn(params: {
  code: string | null | undefined;
  state: string | null | undefined;
  expectedState: string | undefined;
}): Promise<GoogleProfile> {
  verifyState(params.expectedState, params.state);

  if (!params.code) {
    throw new OAuthError('code_missing', 'Google did not return an authorization code.');
  }

  const accessToken = await exchangeCodeForToken(params.code);
  return fetchGoogleProfile(accessToken);
}
