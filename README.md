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
- Owner-initiated messaging: a WhatsApp deep link plus optional email notifications.
- Bilingual English/Hebrew, including RTL layout.

**Explicitly not in v1:** payments and deposits, multi-staff scheduling, waitlists,
calendar sync (Google/Outlook), or automated SMS/WhatsApp sending. Owner-initiated
WhatsApp is a `wa.me` link the owner taps, not an API integration.

## Requirements

- Node.js 20+
- PostgreSQL 14+

## Self-hosting quickstart

```bash
git clone https://github.com/<your-fork>/torim.git
cd torim
npm ci
cp .env.example .env.local
```

Create a database, then fill in `.env.local` — at minimum `DATABASE_URL`,
`MIGRATE_DATABASE_URL`, `APP_DB_ROLE`, `APP_DB_PASSWORD`, and `SESSION_PASSWORD`
(`openssl rand -base64 32`). See the comments in `.env.example` for what each
variable does and which are required.

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
