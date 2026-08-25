# Torim

Torim (תורים — Hebrew for "queues"/"appointments") is open-source appointment
booking software for small service businesses: salons, barbers, clinics, studios,
anyone who takes bookings by the slot. It's multi-tenant (one deployment can host
many businesses), mobile-first, and bilingual — English and Hebrew with right-to-left
layout — from the ground up. MIT licensed.

## Status

Early development, pre-1.0. The schema, tenancy model and core booking logic exist
and are tested against real Postgres, but the product is not feature-complete and
APIs may still change. Don't run it for a real business yet.

## Features (v1 scope)

- Services with durations, prices, and configurable buffers before/after each booking.
- Working hours per weekday, breaks (a second working-hours row for the same day),
  and one-off or recurring closed dates.
- A slot picker that respects buffers, a minimum-notice window, and a booking horizon
  (how far ahead customers can book).
- Customer booking with phone-first identity — no account, no password.
- An admin day/week calendar with manual entry for phone or walk-in bookings.
- Owner-initiated messaging: a `wa.me` link the owner taps, which needs no account
  and no provider.
- Optional automated notifications through a transport the deployment configures
  itself. Nothing is configured out of the box, and nothing is sent by default.
- Bilingual English/Hebrew, including RTL layout.

**Explicitly not in v1:** payments and deposits, multi-staff scheduling, waitlists,
or calendar sync (Google/Outlook). Torim also ships with **no messaging provider and
no account with anybody** — a fresh clone sends nothing, and no phone number, endpoint
or key for any provider exists in this repository. Automated sending is opt-in per
deployment; see [Notifications](#notifications).

## Requirements

- Node.js 22.22+ (24 recommended — CI runs 24)

  > Node 20 reached end of life in April 2026. The app itself would run on it, but
  > the test suite needs a supported runtime, and shipping a booking system that
  > handles personal data on an unmaintained Node is not a trade worth making.
- PostgreSQL 14+

## Self-hosting quickstart

```bash
git clone https://github.com/<your-fork>/torim.git
cd torim
npm ci
cp .env.example .env.local
```

Create a database. **Name it with a `_dev` or `_test` suffix** — `npm run db:seed`
is destructive and refuses to run against anything else, so that the demo seed can
never be pointed at a real instance by accident:

```bash
createdb torim_dev
```

Then fill in `.env.local` — at minimum `DATABASE_URL`, `MIGRATE_DATABASE_URL`,
`APP_DB_ROLE`, `APP_DB_PASSWORD`, and `SESSION_PASSWORD` (`openssl rand -base64 32`).
The defaults in `.env.example` already assume `torim_dev`. See the comments there for
what each variable does and which are required.

```bash
# Apply the schema, as the database owner (MIGRATE_DATABASE_URL).
npm run migrate

# Create the restricted application role, as the owner.
npm run db:grant

# Prove DATABASE_URL is that restricted role, not the owner. See the warning below.
npm run db:check-role

# Load a demo business with services, hours, and bookings.
npm run db:seed

npm run dev
```

Open http://localhost:3000.

> [!WARNING]
> **`DATABASE_URL` must point at a non-superuser role with `NOSUPERUSER` and
> `NOBYPASSRLS`.** Torim's multi-tenancy is enforced entirely by Postgres row-level
> security. Postgres silently *skips* RLS for superusers and for roles with
> `BYPASSRLS` — there is no error, no warning, nothing in the logs. Point the app at
> such a role by mistake and every business will quietly read and write every other
> business's bookings. `npm run db:grant` creates the correct role; `npm run
> db:check-role` asserts a given `DATABASE_URL` is safe before you trust it. CI runs
> the same check before every test run.

## Notifications

**Nothing is sent by default.** Torim ships with no messaging provider and no account
with anybody, so a fresh clone messages nobody.

- **Owner-initiated WhatsApp needs no setup.** Torim composes the message and hands the
  owner a `wa.me` link; tapping it opens WhatsApp on her own device, signed in as her,
  with the text prefilled — she presses send herself. A `wa.me` link carries no sender
  identity, so no number of anyone's is stored in the app or in this repository.
- **Automated messages are opt-in, per deployment.** Set `TORIM_TRANSPORT` (default
  `none`; `smtp` is the other built-in) and supply that transport's own credentials in
  your own environment. An unrecognised value fails loudly rather than quietly sending
  nothing.
- **A fork writes an adapter for whatever it already uses.** The `MessageTransport`
  contract is three members, and there is a complete worked example for a generic HTTP
  messaging API.
- **Or drain the queue from outside**, over the bearer-token ops endpoints, with n8n or
  any cron job.

See [`docs/NOTIFICATIONS.md`](./docs/NOTIFICATIONS.md) for the message flow, the contract
field by field, the worked example, and what v1 deliberately does not do (no retries,
backoff, quiet hours, debouncing or rate caps).

## Architecture, briefly

- **Next.js App Router** for both the admin app and the customer-facing booking
  pages.
- **PostgreSQL with row-level security** as the multi-tenancy mechanism — every
  tenant-scoped table carries a `business_id` and an RLS policy enforced via
  `FORCE ROW LEVEL SECURITY`, keyed off a per-transaction Postgres setting (GUC).
  There is no separate authorization layer re-implementing what RLS already does.
- **No ORM.** Queries are plain SQL against `pg`, run through a small tenant-scoping
  wrapper (`src/lib/db.ts`, `src/lib/tenant.ts`) that sets the tenant GUC and refuses
  to run a tenant-scoped query with no tenant in scope.
- **Migrations** are plain numbered `.sql` files (`scripts/sql/`), applied in order
  and checksummed — see `CONTRIBUTING.md`.
- **Vitest** runs against a real, migrated Postgres database — there is no mocked
  database layer, because a mock can't prove a row-level security policy actually
  does what it claims.

## Running the tests

Tests need a migrated database of their own — the suite is real SQL against real
Postgres, not mocks:

```bash
createdb torim_test   # or your platform's equivalent
MIGRATE_DATABASE_URL=postgres://<owner>@localhost:5432/torim_test npm run migrate
MIGRATE_DATABASE_URL=postgres://<owner>@localhost:5432/torim_test npm run db:grant
npm run test
```

`TEST_DATABASE_URL` in `.env.local` should point at that database, as the restricted
app role — same warning as above applies.

## License and contributing

MIT — see [`LICENSE`](./LICENSE). See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how
to set up a dev environment, the migration rule, and what to expect from
contributions right now.
