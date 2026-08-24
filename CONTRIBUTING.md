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
npm run db:grant      # creates the restricted app role
npm run db:check-role # proves DATABASE_URL is that restricted role, not the owner
npm run db:seed       # optional — a demo business to develop against
npm run dev
```

## Running the suite

```bash
npm run lint
npx next build   # also regenerates the App Router route types tsc needs
npm run typecheck
npm run test
```

Tests run real SQL against a real, migrated Postgres database — set `TEST_DATABASE_URL`
in `.env.local` first (a separate database from your dev one; `npm run migrate` and
`npm run db:grant` need to have been run against it too). There's no mocked database
layer, so this isn't optional for anything that touches `src/lib/db.ts` or RLS.

CI (`.github/workflows/ci.yml`) runs the same steps in the same order against a
throwaway Postgres service container — nothing there needs secrets, so it also runs
on fork PRs.

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

## Contributions

This is a side project with no SLA. PRs and issues are welcome, but there's no
promised review time and no roadmap commitment. If you're planning something
larger than a small fix, opening an issue first to talk it through will save you
more time than it costs.
