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

Create a database. **Name it with a `_dev`, `_test`, or `_demo` suffix** — `npm run
db:seed` is destructive and refuses to run against anything else, so that the demo
seed can never be pointed at a real instance by accident:

```bash
createdb torim_dev
```

Then fill in `.env.local`. At minimum:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | The app's connection — the **restricted** role, see the warning below. |
| `MIGRATE_DATABASE_URL` | The schema owner. Used only by `migrate` and `db:grant`. |
| `APP_DB_ROLE`, `APP_DB_PASSWORD` | The restricted role `db:grant` creates. |
| `SESSION_PASSWORD` | Seals the admin session cookie. `openssl rand -base64 32`, 32 chars minimum, no default. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. **There is no other way into `/admin`** — see [Google sign-in](#google-sign-in). |
| `OAUTH_REDIRECT_URI` | Must match what you register with Google byte for byte. |

The defaults in `.env.example` already assume `torim_dev`. See the comments there for
what each variable does and which are required.

```bash
# Apply the schema, as the database owner (MIGRATE_DATABASE_URL).
npm run migrate

# Create the restricted application role and grant it the schema, as the owner.
# ⚠ Re-run this after EVERY migrate, not just the first one — see the note below.
npm run db:grant

# Prove DATABASE_URL is that restricted role, not the owner. See the warning below.
npm run db:check-role

# Load a demo business with services, hours, and bookings. You will run this
# again later, with SEED_OWNER_EMAIL, to make yourself its owner.
npm run db:seed

npm run dev
```

Now **open http://localhost:3000/b/demo** — that is the seeded demo business's public
booking page, and it works immediately with no sign-in, because customers never sign in.
(`http://localhost:3000` is a static description of the project with nothing to click.)

The admin side needs Google credentials and a couple more steps, in an order that is not
the obvious one — see [First run: getting into /admin](#first-run-getting-into-admin).

> [!WARNING]
> **`DATABASE_URL` must point at a non-superuser role with `NOSUPERUSER` and
> `NOBYPASSRLS`.** Torim's multi-tenancy is enforced entirely by Postgres row-level
> security. Postgres silently *skips* RLS for superusers and for roles with
> `BYPASSRLS` — there is no error, no warning, nothing in the logs. Point the app at
> such a role by mistake and every business will quietly read and write every other
> business's bookings. `npm run db:grant` creates the correct role; `npm run
> db:check-role` asserts `DATABASE_URL` is safe before you trust it.
>
> `scripts/check-role.ts` reads **`DATABASE_URL` and nothing else** — it takes no
> argument and never looks at `TEST_DATABASE_URL`. CI runs it ahead of the suite, and it
> does cover the suite there, but only because CI happens to set both variables to the
> same connection string. If yours differ, point `DATABASE_URL` at the test database and
> run it again.

> [!IMPORTANT]
> **`npm run db:grant` must be re-run after every `npm run migrate`.** It issues
> `GRANT … ON ALL TABLES IN SCHEMA torim`, and `ALL TABLES` means the tables that exist
> at that moment — it is not a standing rule, and there are no `ALTER DEFAULT
> PRIVILEGES` here. Nor does it ever cover functions, which are granted one by one in
> `scripts/grant-app-role.ts`.
>
> So a `git pull` that brings a new migration, followed by a bare `npm run migrate`,
> leaves the app role with no rights on whatever that migration created. The symptom is
> a bare `permission denied for table …` from a schema that migrated cleanly one second
> earlier. `003_date_overrides.sql` and `004_public_booking.sql` each say so in a
> trailing SQL comment; nobody reads those after the migration has already succeeded.
> Make it muscle memory: **`migrate`, then `db:grant`, every time.**

### The demo seed is destructive

`npm run db:seed` deletes and re-inserts every service, working-hours row, closure,
customer and booking belonging to the `demo` business. Its only guard is the *name* of
the database in `DATABASE_URL`: it refuses to run unless that name ends in `_dev`,
`_test`, or `_demo`, which is why the quickstart names the database `torim_dev` (and
why a publicly hosted demo can safely use `torim_demo` instead of ever setting
`ALLOW_DESTRUCTIVE_SEED`).

`ALLOW_DESTRUCTIVE_SEED=1` turns that guard off. It is the one thing standing between a
mistyped or stale `DATABASE_URL` and destroying a real business's data with no way back.
Leave it unset. Never put it in a shell profile or a platform environment — if you ever
genuinely need it, prefix the single command with it and let it die there.

`npm run db:reset` is more destructive still: it TRUNCATEs every table in schema `torim`
except `schema_migrations`, for every business, as the schema owner
(`MIGRATE_DATABASE_URL`) — sharing the same database-name guard and
`ALLOW_DESTRUCTIVE_SEED` escape hatch.

## First run: getting into /admin

The seed creates a business. It does **not** create a user, and it deliberately cannot:
Torim keys users on their Google subject id, never on their email address, so a user row
invented by a script would never match a real sign-in. The membership would look correct
in the database and do nothing.

So the first run goes sign-in first, seed second:

1. **Configure Google sign-in** ([below](#google-sign-in)) and start the app.
2. **Sign in once** at http://localhost:3000/login. You will land on `/onboarding` —
   signed in, with no business yet. That is the normal first-run state, not an error.
3. **Attach yourself to the demo business** by re-running the seed with your address:

   ```bash
   SEED_OWNER_EMAIL=you@example.com npm run db:seed
   ```

   The seed prints whether it found your account. If it says there is no account yet for
   that address, step 2 did not complete — sign in, then re-run.
4. **Open http://localhost:3000/admin.** Your existing session still has no active
   business, so you will be bounced through Google once more; that round trip is what
   picks up the new membership. You land on the demo business's day calendar.

If you would rather not use the demo data at all, skip the seed and just fill in the form
on `/onboarding` — that creates a business of your own with you as its owner, through
`torim.create_business_with_owner`.

## Google sign-in

Torim's admin side has exactly one way in: Google. There is no password login, no magic
link and no bootstrap admin account. Without `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `OAUTH_REDIRECT_URI` set, `/admin` is unreachable — every
attempt bounces to `/login?error=misconfigured`, with the real reason logged
server-side only.

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. **Create an OAuth client of type "Web application."** That is the type that issues a
   client secret and accepts *Authorized redirect URIs*, and this flow needs both: the
   secret is posted server-to-server during the code exchange and never reaches the
   browser (`exchangeCodeForToken` in `src/lib/oauth.ts`).
2. **Register the redirect URI exactly.** For local development that is:

   ```
   http://localhost:3000/api/auth/google/callback
   ```

   Then put the *same string* in `OAUTH_REDIRECT_URI`.

   > [!IMPORTANT]
   > It must match **byte for byte** — scheme, host, port, path, and no trailing slash.
   > `127.0.0.1` is not `localhost` as far as Google is concerned. Torim reads this
   > value from configuration and never derives it from the incoming request, precisely
   > so it cannot drift; it is sent both on the way out to Google and again during the
   > code exchange, and Google rejects the whole sign-in if either copy differs from
   > what is registered.
3. **Add yourself as a test user.** A new OAuth client's consent screen starts in
   *Testing* publishing status, and while it is there only Google accounts on its
   **Test users** list may complete the flow — in the current console that list lives
   under *Google Auth Platform → Audience*. Your own account is not on it automatically.
   Add the account you intend to sign in with, or Google blocks you at its own consent
   screen — an error page on Google's domain, before Torim ever sees the request, so
   there is nothing in your own logs to explain it.

### What Torim asks for

Three scopes, and only these three (`GOOGLE_SCOPES` in `src/lib/oauth.ts`):

| Scope | Why |
| --- | --- |
| `openid` | The stable subject id — the join key. Email addresses move between people; `sub` does not. |
| `email` | Identifies which owner or staff member signed in. |
| `profile` | A display name for the admin header. |

No calendar, no contacts, no Gmail, no offline access. The authorization request sets
`access_type=online`, so Google never issues a refresh token — Torim never acts on
anyone's behalf while they are away, so storing one would be keeping a credential it has
no use for. It also sets `prompt=select_account`, because a shop's owner and staff often
share one machine and one browser profile.

Sign-in also depends on `SESSION_PASSWORD`: the CSRF `state` nonce is parked in the
sealed session cookie and compared on the way back, so a deployment without a session
secret cannot complete the round trip at all.

## Notifications

**Nothing is sent by default.** Torim ships with no messaging provider and no account
with anybody, so a fresh clone messages nobody.

- **Owner-initiated WhatsApp needs no setup.** Torim composes the message and hands the
  owner a `wa.me` link; tapping it opens WhatsApp on her own device, signed in as her,
  with the text prefilled — she presses send herself. A `wa.me` link carries no sender
  identity, so no number of anyone's is stored in the app or in this repository.
- **Automated messages are opt-in, per deployment.** Set `TORIM_TRANSPORT` (default
  `none`; `smtp` is the other built-in) and supply that transport's own credentials in
  your own environment. An unrecognised value refuses to start, at boot, in
  `src/instrumentation.ts` — rather than quietly sending nothing.
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
Postgres, not mocks.

**Set `TEST_DATABASE_URL` in `.env.local` first**, pointing at that separate database as
the restricted app role — the same non-superuser, no-`BYPASSRLS` warning applies. Do
this *before* running anything below, not after. `src/test-setup.ts` overrides
`DATABASE_URL` with `TEST_DATABASE_URL` **only if that variable is set**; leave it unset
and the entire suite runs against whatever `DATABASE_URL` names, which is your
development database. Tests do roll their writes back (`src/lib/test-db.ts` pins one
connection inside a transaction per file), so this is usually survivable rather than
destructive — but they are real writes against real rows while they run, and an
interrupted run can leave a transaction open on the database you are developing against.

```bash
createdb torim_test   # or your platform's equivalent
MIGRATE_DATABASE_URL=postgres://<owner>@localhost:5432/torim_test npm run migrate
MIGRATE_DATABASE_URL=postgres://<owner>@localhost:5432/torim_test npm run db:grant
npm run test
```

Re-run that `db:grant` line after any later migration too, for the same reason as above.

Note that `npm run db:check-role` will not vet this database for you — it reads
`DATABASE_URL` only. To check the test database, run it once with `DATABASE_URL`
temporarily set to `TEST_DATABASE_URL`'s value.

## Running it for real

The quickstart above is a development setup. `npm run dev` is not a production server.

```bash
npm ci
npm run migrate     # from a shell with MIGRATE_DATABASE_URL exported
npm run db:grant    # same shell — and again after every future migrate
npm run build
npm run start
```

What has to change from the development values:

- **`OAUTH_REDIRECT_URI` → your real origin**, e.g.
  `https://booking.example.com/api/auth/google/callback` — and register that exact
  string as an Authorized redirect URI on the same Google OAuth client. Google matches
  it byte for byte; a localhost value left in place means nobody can sign in.
- **`APP_BASE_URL` → the same public origin.** Nothing crashes without it, which is the
  problem: management links in notification emails fall back to a relative
  `/manage/<token>` that is a dead link the moment it leaves the server, and the admin
  settings page shows that same relative path as the business's shareable booking link.
- **Serve it over HTTPS.** The session cookie is set `secure` when `NODE_ENV` is
  `production` (`getSessionOptions` in `src/lib/auth.ts`), so a plain-HTTP production
  origin means the browser drops the cookie carrying the OAuth `state` nonce and every
  sign-in fails the CSRF check.
- **`SESSION_PASSWORD`** must be a real random secret, not the one from your laptop.
  Rotating it signs everybody out at once; there is no per-session revocation.
- **`TRUSTED_PROXY_HOPS`** must match how many proxies actually sit in front of you
  (default `1`). Get this wrong upwards and every IP-based rate limit on the public
  booking pages silently stops working. Read
  [the rate-limiting section of `SECURITY.md`](./SECURITY.md#rate-limiting-and-the-two-things-it-depends-on)
  before you deploy behind a CDN.
- **Leave `MIGRATE_DATABASE_URL` unset in the running app.** It is the schema owner's
  connection and the app has no business holding it. Export it in the shell you run
  `migrate` and `db:grant` from, and nowhere else.
- **Leave `ALLOW_DESTRUCTIVE_SEED` unset**, and don't run `npm run db:seed` against
  anything real.
- **Publish the Google consent screen** once you are past testing, or only the accounts
  on its test-user list can sign in.

Torim is still pre-1.0 (see [Status](#status)) — this is how to run it properly, not a
claim that you should yet.

## License and contributing

MIT — see [`LICENSE`](./LICENSE). See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how
to set up a dev environment, the migration rule, and what to expect from
contributions right now.
