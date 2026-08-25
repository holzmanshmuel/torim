# Security Policy

## Reporting a vulnerability

Email **holzmanshmuel@gmail.com** with a description and, if you have one, steps to
reproduce. This is a small, part-time-maintained open-source project — expect an
acknowledgement within a few days, not a few hours, and no formal disclosure
timeline or bug bounty. Please don't open a public issue for anything that could be
used to compromise a live deployment before it's fixed.

## Supported versions

Torim is pre-1.0 and moving. Only the latest commit on `main` is supported; there
are no maintained release branches yet. If you're self-hosting, stay current.

## Threat model: tenant isolation

The core security property of a multi-tenant Torim deployment is that one business
can never read or write another business's data. This is enforced almost entirely
by PostgreSQL itself, not by application code:

- **Row-level security on every tenant table.** `services`, `working_hours`,
  `closures`, `customers`, `bookings`, `notifications` (all in
  `scripts/sql/002_booking_domain.sql`) and `date_overrides`
  (`scripts/sql/003_date_overrides.sql`) each carry a `business_id` column and an RLS
  policy that only permits rows matching the active tenant.

  `businesses`, `users` and `memberships` carry no RLS policy, deliberately: they are
  the tables that decide *which* tenant you are, and must be readable before a tenant
  exists at all (sign-in, onboarding, slug lookup). They are reached only through
  `systemQuery()` / `withSystemTransaction()` in `src/lib/db.ts`, which are documented
  there as legal against those three tables and nothing else.
- **`FORCE ROW LEVEL SECURITY`** on those tables, so the policy applies even to
  queries run by the table owner (e.g. from a migration or an admin shell), not just
  to an unprivileged role.
- **A per-transaction Postgres setting (GUC), `torim.business_id`**, is what the
  policy actually checks. The application sets it once at the start of every
  tenant-scoped transaction (`src/lib/db.ts`'s `withTransaction`) and it never
  crosses a connection back into the pool — `set_config(..., true)` is
  transaction-local by design.
- **The application's database role must not be a superuser and must not have
  `BYPASSRLS`.** This is the single most important operational fact in this
  project: Postgres silently *skips* row-level security for such roles — no error,
  no warning, no log line. A deployment that accidentally connects as a superuser
  would pass every tenant-isolation test and leak every business's data to every
  other business in production. `npm run db:grant` provisions a role without these
  privileges; `npm run db:check-role` connects and asserts it isn't one of them.

  Know what that check covers: `scripts/check-role.ts` reads **`DATABASE_URL` only**.
  It has no argument and never inspects `TEST_DATABASE_URL`. CI runs it before the
  test suite (`.github/workflows/ci.yml`), and it does cover the suite there — but
  only because CI sets `DATABASE_URL` and `TEST_DATABASE_URL` to the same connection
  string. If yours differ, the check has said nothing at all about the database your
  tests actually run against; re-run it with `DATABASE_URL` temporarily pointed at
  that one.
- **Exactly two `SECURITY DEFINER` functions**, and no more. Both exist for the same
  reason — a caller who legitimately has no tenant context yet — and rather than give
  the application role a general RLS bypass to cover them, each is confined to one
  narrowly-scoped function. Both `REVOKE ALL … FROM PUBLIC` and are then granted
  `EXECUTE` to the app role alone (`scripts/grant-app-role.ts`), and both pin
  `search_path = torim, pg_temp` so the definer's rights cannot be redirected at a
  shadowed object.

  - **`torim.create_business_with_owner`** (`scripts/sql/001_tenancy.sql`) — the one
    legitimate cross-tenant *write*. Onboarding is the chicken-and-egg case: a
    signed-in user with no business has no tenant to scope to. It creates the
    `businesses` row and its `owner` membership together, and returns the new
    business id.
  - **`torim.business_for_manage_token`** (`scripts/sql/004_public_booking.sql`) — the
    one legitimate cross-tenant *read*. A booking-management link is a capability URL,
    so resolving it necessarily happens before any tenant scope exists, and RLS
    correctly hides `torim.bookings` from an unscoped connection. **It returns a bare
    `business_id` and nothing else** — no booking, no customer, no times. Everything
    else about that booking is then read normally, under RLS, once the tenant scope has
    been entered. It is `STABLE` and read-only, and the most an attacker guessing
    tokens can learn from it is whether a token exists — against a token that is a
    256-bit SHA-256 digest of two `gen_random_uuid()` values (~244 bits of actual
    entropy), minted by the column default in `scripts/sql/002_booking_domain.sql`
    rather than by application code.

  Adding a third is a security decision, not a convenience one. Confining the bypass
  to a function that returns one opaque id is what keeps "we had to look outside the
  tenant" from becoming "we can read outside the tenant".

## The ops endpoints and outbound messaging

- **The ops endpoints are gated by a bearer token, `OPS_TOKEN`.** It is a
  server-to-server secret for an external system draining the notification queue — n8n,
  a cron job, a worker. It is never rendered, never sent to a browser, and never
  user-facing: nothing a customer or a signed-in owner touches reads it. Leave it unset
  and the endpoints stay closed, which is the default; the product works without them.
  Treat it like any other server credential — rotate it if it leaks, and do not reuse
  `SESSION_PASSWORD` for it.
- **Torim ships with no messaging provider and no account with anybody.** A fresh clone
  sends nothing. There is no phone number, endpoint or API key for any provider in this
  repository.
- **Customer contact details leave the system only through a transport the deployment
  configured itself.** With `TORIM_TRANSPORT` unset or `none` — the default — no
  customer name, phone number or email address is transmitted anywhere by the server at
  all. Choosing a transport is the act that starts sending personal data to a third
  party, under that deployment's own agreement with them, and it is a deliberate,
  explicit configuration change. See [`docs/NOTIFICATIONS.md`](./docs/NOTIFICATIONS.md).
- **The owner-initiated WhatsApp path sends nothing from the server.** A `wa.me` link is
  composed in the browser and opens WhatsApp on the owner's own device, under her own
  account; the message is hers to send. The link carries no sender identity, so no
  number belonging to the business or to Torim is embedded anywhere.
- **Anything a transport carries should be treated as sensitive**, particularly a
  booking-management link — see the capability-URL note below.

## Rate limiting, and the two things it depends on

The public booking surface has no customer accounts and no verification by design, so
rate limiting carries a real share of the abuse load. Both of the following are
properties of *your deployment*, not of the code, and both can silently turn the limits
into decoration.

### The limits are per process

`src/lib/rate-limit.ts` is an in-process sliding window — a `Map` in the Node heap.
There is no Redis, no shared store, and no coordination between instances.

- **Behind N instances, every limit is effectively N times what it says.** Two
  instances behind a load balancer means the 10-bookings-per-15-minutes IP limit in
  `src/app/b/lib/rate-limits.ts` is really 20. Four means 40. Divide the configured
  numbers by your instance count to get the number an attacker actually faces.
- **The window does not survive a restart or a scale-to-zero.** A platform that
  recycles the process resets every counter with it.
- A shared store is the fix if Torim ever runs horizontally scaled. Until then, treat
  the limits as a brake on casual abuse, not as a control you can size against a
  determined attacker.

### The limits are only as good as `TRUSTED_PROXY_HOPS`

Every IP-keyed limiter derives its key from `clientAddress()` in
`src/app/b/lib/rate-limits.ts`, which reads the `x-forwarded-for` request header. That
header is **appended to** by each proxy it passes through, so its left-most entry is
whatever the client chose to send — attacker-supplied, and different on every request if
the attacker wants it to be. `clientAddress()` therefore counts from the **right** and
requires the entry to parse as an IP address.

Counting from the right requires knowing how many proxies are in front of you.
`TRUSTED_PROXY_HOPS` is that number.

- **Default `1`** — one trusted proxy (a load balancer, a CDN, a reverse proxy)
  appending the address it observed. This is the common single-hop deployment.
- **Set it to your real hop count.** Two proxies in front means `2`. Cloudflare in
  front of a platform load balancer that also appends is `2`, not `1`.
- **`0` means "nothing in front is trusted"** and the header is ignored entirely,
  including `x-real-ip`.

> [!WARNING]
> **Setting the hop count higher than the number of proxies you actually have makes
> every IP-keyed limit ineffective.** The index is counted back from the end of the
> chain, and the *client* controls how long that chain is — it can send as many
> comma-separated entries as it likes before your proxies append theirs. Configure one
> hop too many and an attacker pads the header until the index lands on an entry it
> chose, then varies that entry per request: a fresh bucket every time, never limited.
> This fails open and fails silently — nothing logs, nothing errors, and the limits
> look configured. If you are unsure, guess **low**: `0` is the safe wrong answer.

Setting it *lower* than reality is the safe direction: the key collapses to a proxy's
own constant address, so all traffic shares one bucket and honest customers get
throttled together. Which is also what happens with **no proxy at all** — a deployment
where Node is directly exposed sees no `x-forwarded-for`, `clientAddress()` returns the
literal string `unknown`, and **all traffic shares a single bucket**. That is
deliberate: an unknown address must still be limited rather than exempt. But it means a
single-process, no-proxy deployment cannot distinguish one abusive client from all its
real customers.

Only the per-phone booking limiter (`bookingPhoneLimiter`) is independent of all this —
it keys on the submitted phone number, so it still bites when the address key is
useless.

## Known limitations

- **No customer-side identity verification in v1.** A customer booking is
  phone-first: name and phone number, no account, no OTP/SMS verification. Abuse is
  mitigated by rate limiting and an owner-facing "confirm new customers" toggle
  (bookings from an unrecognized phone number land as `pending` until the owner
  approves), not by proving phone ownership. Do not treat a booking's phone number
  as verified.
- **Booking-management links are capability URLs**, not authenticated sessions. The
  link a customer uses to view or cancel their own booking embeds a long, randomly
  generated token (`bookings.manage_token`, minted by the database default, not
  application code) rather than requiring sign-in. Anyone who obtains that exact
  URL can act on that one booking. Treat it like a password: don't log it, don't
  put it somewhere it will be indexed, and treat SMS/email/WhatsApp transports that
  carry it as sensitive.
- **No audit log.** There is currently no record of who changed what, beyond the
  `updated_at` timestamps and the customer/owner "last changed" markers already in
  the schema.
- **Owner sessions rely on a single secret**, `SESSION_PASSWORD`. There is no
  session revocation list or per-session invalidation yet — rotating the secret
  invalidates every session at once.
