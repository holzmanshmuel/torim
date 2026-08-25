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
  `closures`, `customers`, `bookings`, and `notifications` each carry a `business_id`
  column and an RLS policy that only permits rows matching the active tenant.
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
  privileges; `npm run db:check-role` asserts a given connection isn't one of them;
  CI runs that assertion before the test suite runs, specifically so the test suite
  can't rot into testing nothing.
- **One `SECURITY DEFINER` function, `torim.create_business_with_owner`**, is the
  sole intentional exception. Onboarding a new business is the one legitimate
  cross-tenant write — a signed-in user with no business yet has no tenant context
  to scope to. Rather than giving the application role a general RLS bypass, that
  one operation is confined to a single, narrowly-scoped function, executable only
  by the app role, that creates the business row and its owner membership together.

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
