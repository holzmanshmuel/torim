/**
 * Which hosts this deployment answers on.
 *
 * Two things consult this list, and they must agree:
 *   - `next.config.ts` passes it to `experimental.serverActions.allowedOrigins`, the
 *     hosts whose Server Action requests are honoured (below);
 *   - `resolveOAuthRedirectUri` in `src/lib/oauth.ts` uses it to decide which hosts a
 *     Google sign-in may come back to (see there).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Every mutation in Torim is a Server Action, and Next.js protects those against
 * CSRF by comparing the browser's `Origin` header to the request's `Host` (or
 * `X-Forwarded-Host`). Same-origin is allowed automatically, so a plain
 * single-host deployment needs nothing here.
 *
 * A reverse proxy that REWRITES Host breaks that comparison. The browser sends
 * `Origin: https://bookings.example.com`, the proxy forwards the request to the
 * upstream under its own internal hostname, and Next.js sees two different values
 * and aborts. This is not exotic — it is what a Cloudflare Worker, a multi-zone
 * setup, or any platform that routes by Host does.
 *
 * The failure is unusually nasty to diagnose, which is the real reason this file
 * has a comment this long. Every page renders fine, because GETs are untouched.
 * Only mutations fail, with a generic minified React error in the browser, a bare
 * 500 in the access log, and NOTHING in the application log — the request never
 * reaches application code. The obvious suspects (database, credentials, RLS) are
 * all innocent, and the symptom looks like a data problem rather than a config one.
 *
 * `APP_BASE_URL` already names the public origin, so it is always on the list:
 * whatever host the product tells customers to visit is exactly the host whose
 * Server Action requests must be honoured. Deriving it rather than asking for it a
 * second time means the two cannot drift apart.
 *
 * `SERVER_ACTIONS_ALLOWED_ORIGINS` adds more, for a deployment that answers on more
 * than one hostname — typically while moving to a new domain, when the old name
 * and the new one both have to work. It is a comma-separated list of hosts
 * (`old.example.com,new.example.com`); full origins are accepted too. Leave it unset
 * and the list is exactly what `APP_BASE_URL` alone gives.
 */

/** The environment this reads. Loose on purpose, so `process.env` passes as-is. */
export type AllowedHostsEnv = Record<string, string | undefined>;

/**
 * Every host this deployment answers on, in the form Next.js wants.
 *
 * Next.js matches on the host DOMAIN — `bookings.example.com`, not
 * `https://bookings.example.com` — so the scheme and path are dropped and the port
 * is kept only when the value carries a non-default one, exactly as the Host header
 * does. The host of `APP_BASE_URL` comes first, then each extra host, with
 * duplicates removed.
 *
 * @throws if `APP_BASE_URL` is set to something that is not a URL, or an entry of
 *   `SERVER_ACTIONS_ALLOWED_ORIGINS` cannot be read as a host — see the tests for
 *   why that is deliberately louder than returning a shorter list.
 */
export function allowedHosts(env: AllowedHostsEnv): string[] {
  const hosts: string[] = [];

  const base = env.APP_BASE_URL?.trim();
  if (base) hosts.push(hostOfBaseUrl(base));

  for (const entry of (env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? '').split(',')) {
    const value = entry.trim();
    // A trailing comma or a doubled one is a typing habit, not a malformed host.
    if (value) hosts.push(hostOfExtraEntry(value));
  }

  return [...new Set(hosts)];
}

/**
 * The host of `APP_BASE_URL`. Unset is the ordinary case for a single-origin
 * deployment and is handled by the caller; a value that is set must be a full URL.
 */
function hostOfBaseUrl(raw: string): string {
  try {
    // URL.host keeps a non-default port and omits a default one, which is precisely
    // the rule the Host header follows, so no special-casing is needed here.
    return new URL(raw).host;
  } catch {
    // Deliberately fatal. An empty allowlist behind a Host-rewriting proxy takes
    // every mutation in the product down at runtime and reports it as a generic
    // client-side error; refusing to boot names the problem instead.
    throw new Error(
      `APP_BASE_URL is set to "${raw}", which is not a valid URL. It must be the ` +
        'full public origin, including the scheme — for example ' +
        'https://bookings.example.com.',
    );
  }
}

/**
 * One entry of `SERVER_ACTIONS_ALLOWED_ORIGINS`: a bare host (`new.example.com`,
 * `localhost:3001`) or a full origin (`https://new.example.com/`).
 *
 * Fatal on garbage for the same reason `APP_BASE_URL` is. Quietly dropping the entry
 * would leave that host looking healthy — pages render — while every Server Action
 * and every Google sign-in on it fails.
 */
function hostOfExtraEntry(value: string): string {
  let host = '';
  try {
    host = new URL(value.includes('://') ? value : `https://${value}`).host;
  } catch {
    // fall through to the error below
  }
  if (!host) {
    throw new Error(
      `SERVER_ACTIONS_ALLOWED_ORIGINS contains "${value}", which is not a host. It ` +
        'must be a comma-separated list of hostnames — for example ' +
        'old.example.com,new.example.com.',
    );
  }
  return host;
}
