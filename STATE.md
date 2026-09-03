# Torim — STATE

**Read `README.md` first** (setup, roles, migration chain) and `docs/NOTIFICATIONS.md` before
touching messaging. This file = operational truth, newest on top. Current-state only — git history
is the history.

## What this is

Torim (תורים — "queues/appointments") is open-source, multi-tenant appointment-booking software for
small service businesses: salons, barbers, clinics. Bilingual English/Hebrew with RTL. A customer
books at `/b/[slug]`, manages their booking through a magic link at `/manage/[token]`, and the
business owner administers everything under `/admin/*`.

Next.js 16 (App Router) + React 19, PostgreSQL 14+ with per-tenant row-level security,
`iron-session` for admin auth, Node 22.22+ (CI runs 24). Demo:
**torim.holzman-ai.com/b/demo** — resets nightly, no messaging transport configured.

**Status per README: early development, pre-1.0. "Don't run it for a real business yet."**

## Standing rules

- **Never point `DATABASE_URL` at a superuser or `BYPASSRLS` role.** RLS is then silently skipped
  and tenant isolation stops being enforced. CI asserts this with `db:check-role`.
- **`npm run db:grant` must be re-run after every migrate** — migrations apply as the *owner* role
  (`MIGRATE_DATABASE_URL`); the restricted app role has to be re-granted afterwards.
- Migrations `scripts/sql/001_tenancy.sql` … `008_booking_cap.sql` apply **in order** via
  `scripts/migrate.ts`.
- `db:seed` / `db:reset` are destructive and refuse to run unless the database name ends in
  `_dev`, `_test` or `_demo`. Leave that guard alone.
- Google OAuth is the **only** path into `/admin`. There is no password login to fall back on.
- Messaging is bring-your-own: no provider ships with the repo. Owner-tap `wa.me` links are the
  default; automated sending is opt-in per deployment via `TORIM_TRANSPORT`.
- There is **no built-in cron.** `POST /api/ops/notifications/drain` is token-gated by `OPS_TOKEN`
  and expects an external timer to call it.

## Where it stands

- `main`, clean, level with `origin/main`. Last commit `572a903` (2026-08-26) — "Give `/` somewhere
  to go on every shape of deployment (#1)".
- One stale local branch, **never pushed and not merged**: `backup-before-trailer-strip`
  (`3066142`, "Red-team remediation: two HIGH findings, and honest documentation"). It exists only
  on this disk — `git ls-remote` finds nothing. Safe while nobody runs `git push --all` or a
  `--mirror` push from this checkout.
- Tests: vitest, 39 test files / 512 tests, run against a real Postgres with no mocking layer.
  `vitest.config.mts` sets `fileParallelism: false` deliberately — DB tests each get their own
  rolled-back transaction (`src/lib/test-db.ts`), but `reset-demo.test.ts` runs a schema-wide
  `TRUNCATE` that takes an ACCESS EXCLUSIVE lock, so the whole suite has to be serialized.
- CI (`.github/workflows/ci.yml`) runs on push to main + PRs against a throwaway `postgres:16`
  service container and uses **no GitHub secrets** on purpose, so a fork's CI runs unmodified:
  `npm ci` → migrate (owner) → `db:grant` → `db:check-role` → lint → `next build` → typecheck →
  `npm run test`.
- `docs/NOTIFICATIONS.md` documents a deliberate v1 scope cut — no retries, backoff, quiet hours or
  rate caps, **by design, not omission**. Don't "fix" it as an oversight.

## Log

### 2026-09-03 — STATE.md added

Added during the robustness sprint; the repo had no STATE.md and the conventions above were only
recoverable by reading the README, the CI workflow and `vitest.config.mts` together. No code
changed. Also recorded here so it isn't re-derived: the local-only
`backup-before-trailer-strip` branch was confirmed unpushed and unmerged.
