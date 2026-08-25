# Contributing

Torim is early and moving. There's no formal process yet — just a few rules that
keep the database side of the project honest.

## Setup

```bash
npm ci
cp .env.example .env.local
```

Fill in `.env.local` (see its comments), create a Postgres database, then:

```bash
npm run migrate       # as the schema owner — MIGRATE_DATABASE_URL
npm run db:grant      # creates the restricted app role, and grants it the schema
npm run db:check-role # proves DATABASE_URL is that restricted role, not the owner
npm run db:seed       # optional — a demo business to develop against
npm run dev
```

> [!IMPORTANT]
> **Re-run `npm run db:grant` after every `npm run migrate`, not just the first
> time.** A `git pull` that brings a new migration and a bare `npm run migrate` leaves
> the app role without grants on anything that migration created, and the app starts
> throwing `permission denied` against a schema that just migrated cleanly. See
> [the migration rule](#always-re-run-dbgrant-after-migrate).

## Running the suite

```bash
npm run lint
npx next build   # also regenerates the App Router route types tsc needs
npm run typecheck
npm run test
```

Tests run real SQL against a real, migrated Postgres database — set `TEST_DATABASE_URL`
in `.env.local` **before** you run them (a separate database from your dev one;
`npm run migrate` and `npm run db:grant` need to have been run against it too, and
`db:grant` again after every later migration). There's no mocked database layer, so
this isn't optional for anything that touches `src/lib/db.ts` or RLS.

Note that `npm run db:check-role` reads `DATABASE_URL` only — it never inspects
`TEST_DATABASE_URL`. To prove your *test* database is also behind the restricted role,
run it with `DATABASE_URL` temporarily pointed at that database.

CI (`.github/workflows/ci.yml`) runs the same steps in the same order against a
throwaway Postgres service container — nothing there needs secrets, so it also runs
on fork PRs. It sets `DATABASE_URL` and `TEST_DATABASE_URL` to the same connection
string, which is why `db:check-role` covers the suite there.

## The migration rule

Migrations live in `scripts/sql/` as numbered files (`001_tenancy.sql`,
`002_booking_domain.sql`, ...). `npm run migrate` applies them in order and records a
checksum of each one it applies.

**Never edit an applied migration file.** The runner hard-fails if a file's contents
no longer match the checksum it recorded — on purpose. If you need to change
something a migration already did, add a new numbered file (`003_...sql`) rather
than editing history. This is what makes it safe for two people (or a fresh
`npm run migrate` on a fork) to end up with the same schema regardless of when they
last pulled.

Write new migration SQL idempotently where you can (`IF NOT EXISTS` /
`DROP ... IF EXISTS`) — see the existing files for the pattern — so a
partially-applied database can be repaired by re-running.

### Always re-run `db:grant` after `migrate`

```bash
npm run migrate
npm run db:grant   # not optional — see below
```

`scripts/grant-app-role.ts` issues `GRANT … ON ALL TABLES IN SCHEMA torim` and
`GRANT … ON ALL SEQUENCES IN SCHEMA torim`. **`ALL TABLES` means "all tables that
exist right now."** It is not a standing rule, and there are no `ALTER DEFAULT
PRIVILEGES` in this project — so any table a later migration creates has no grants for
the app role, and neither does any function, which `ALL TABLES` never covered in the
first place.

The symptom is a bare `permission denied for table …` or `permission denied for
function …` at runtime, from a schema that migrated cleanly a second earlier.
`003_date_overrides.sql` and `004_public_booking.sql` both say so in a trailing SQL
comment, which is a place nobody reads after the migration already succeeded.

So: pull, `npm run migrate`, `npm run db:grant`, every time — against your dev database
and against your test database both. If you add a migration that creates a table or a
function, add its `GRANT` to `scripts/grant-app-role.ts` in the same change.

## Contributions

This is a side project with no SLA. PRs and issues are welcome, but there's no
promised review time and no roadmap commitment. If you're planning something
larger than a small fix, opening an issue first to talk it through will save you
more time than it costs.
