/**
 * Which extra hosts may invoke a Server Action.
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
 * `APP_BASE_URL` already names the public origin, so it is the answer: whatever
 * host the product tells customers to visit is exactly the host whose Server
 * Action requests must be honoured. Deriving the allowlist from it rather than
 * from a second setting means the two cannot drift apart.
 *
 * See `next.config.ts`, which passes the result to
 * `experimental.serverActions.allowedOrigins`.
 */

/**
 * Turn the configured public origin into the host list Next.js wants.
 *
 * Next.js matches on the host DOMAIN — `bookings.example.com`, not
 * `https://bookings.example.com` — so the scheme and path are dropped and the port
 * is kept only when the URL carries a non-default one, exactly as the Host header
 * does.
 *
 * @param appBaseUrl the value of APP_BASE_URL, which may legitimately be unset.
 * @throws if it is set to something that is not a URL — see the test for why that
 *   is deliberately louder than returning an empty list.
 */
export function allowedServerActionHosts(appBaseUrl: string | undefined): string[] {
  const raw = appBaseUrl?.trim();

  // Unset is the ordinary case for a single-origin deployment, and Next.js already
  // permits same-origin requests without being told to. Nothing to add.
  if (!raw) return [];

  let parsed: URL;
  try {
    parsed = new URL(raw);
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

  // URL.host keeps a non-default port and omits a default one, which is precisely
  // the rule the Host header follows, so no special-casing is needed here.
  return [parsed.host];
}
