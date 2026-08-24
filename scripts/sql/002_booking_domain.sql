-- 002 — the booking domain. Every table here is tenant-scoped by RLS.
--
-- Conventions:
--  * business_id carries a DEFAULT read from the same GUC the policy checks, so inserts
--    never have to name it and can never name someone else's.
--  * Money is an integer in the currency's minor unit. No floats, ever.
--  * Day keys (working hours, closures) are timezone-free: a weekday number or a `date`.
--    Instants (bookings) are timestamptz. Never mix the two.

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.services (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) > 0),
  name_he           text,
  description       text,
  duration_min      integer NOT NULL CHECK (duration_min BETWEEN 1 AND 1440),
  price_minor       integer NOT NULL CHECK (price_minor >= 0),

  -- Buffers extend the interval the slot engine treats as busy, without extending what
  -- the customer sees booked. See bookings.blocks_from / blocks_until.
  buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min BETWEEN 0 AND 240),
  buffer_after_min  integer NOT NULL DEFAULT 0 CHECK (buffer_after_min  BETWEEN 0 AND 240),

  colour            text NOT NULL DEFAULT 'blue',
  sort_order        integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_business_idx ON torim.services (business_id, sort_order);

-- ---------------------------------------------------------------------------
-- working_hours — the weekly template.
--
-- weekday: 0=Sunday … 6=Saturday (the week starts Sunday in the primary market).
-- Breaks are expressed as *absence*: two rows for one weekday (09:00–13:00, 14:00–18:00)
-- means the hour between them is not bookable. There is no separate "break" table.
-- Minutes are minutes-from-local-midnight; end_min may be up to 1440.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.working_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min   integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min     integer NOT NULL CHECK (end_min   BETWEEN 1 AND 1440),
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- A window that ends before it starts blocks nothing and reads as valid to a human.
  -- The salon app shipped exactly this bug via two independent time pickers with no
  -- cross-validation: customers booked straight through hours the owner believed closed,
  -- and nothing errored anywhere. Enforce it in the schema, not in the form.
  CONSTRAINT working_hours_ordered CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS working_hours_business_idx ON torim.working_hours (business_id, weekday);

-- ---------------------------------------------------------------------------
-- closures — days or part-days the business is shut.
--
-- start_min/end_min both NULL = the whole day.
-- kind 'holiday_reopened' is a MARKER, not an absence: it records that the owner
-- deliberately reopened a day a holiday sync had closed, so a later re-sync cannot
-- silently close it again. Deleting the marker instead of no-op'ing on a double-tap
-- is how the salon app silently re-closed a day its owner had opened.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.closures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  on_date     date NOT NULL,
  start_min   integer CHECK (start_min BETWEEN 0 AND 1439),
  end_min     integer CHECK (end_min   BETWEEN 1 AND 1440),
  kind        text NOT NULL DEFAULT 'manual'
                CHECK (kind IN ('manual', 'holiday', 'holiday_reopened')),
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT closures_range_complete CHECK (
    (start_min IS NULL AND end_min IS NULL) OR (start_min IS NOT NULL AND end_min IS NOT NULL)
  ),
  CONSTRAINT closures_ordered CHECK (end_min IS NULL OR end_min > start_min)
);

CREATE INDEX IF NOT EXISTS closures_business_date_idx ON torim.closures (business_id, on_date);

-- ---------------------------------------------------------------------------
-- customers — booked-by people. Phone is identity; there is no account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  phone_e164  text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email       text,
  blocked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, phone_e164)
);

-- ---------------------------------------------------------------------------
-- bookings
--
-- No 'completed' status: completion is derived from ends_at < now(). A status you have
-- to keep in sync with the clock is a status that drifts.
--
-- Price and buffers are SNAPSHOT onto the row so editing the service catalogue never
-- rewrites history.
--
-- There is deliberately NO exclusion constraint forbidding overlap. The owner must be
-- able to force one (double-booking a quick job on purpose is normal). Race safety comes
-- from a transaction-scoped advisory lock plus a conflict re-check — see the booking
-- engine. The salon project added a btree_gist EXCLUDE constraint and dropped it one
-- migration later for exactly this reason.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES torim.customers(id) ON DELETE RESTRICT,
  service_id        uuid NOT NULL REFERENCES torim.services(id)  ON DELETE RESTRICT,

  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,

  buffer_before_min integer NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min  integer NOT NULL DEFAULT 0 CHECK (buffer_after_min  >= 0),

  -- The interval the slot engine treats as occupied: the appointment plus its buffers.
  -- Materialised (not computed per query) so conflict lookups can use an index, and
  -- maintained by a trigger so they can never disagree with the buffers stored beside
  -- them. They cannot be GENERATED columns: timestamptz +/- interval is STABLE rather
  -- than IMMUTABLE in Postgres, because for day-and-larger units the answer depends on
  -- the session timezone. That is the same DST sensitivity this app cares about, so the
  -- restriction is correct even though our intervals are only ever minutes.
  blocks_from       timestamptz NOT NULL,
  blocks_until      timestamptz NOT NULL,

  status            text NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'no_show')),

  price_minor       integer NOT NULL CHECK (price_minor >= 0),
  final_price_minor integer CHECK (final_price_minor >= 0),

  note              text,
  source            text NOT NULL DEFAULT 'customer' CHECK (source IN ('customer', 'admin')),

  -- Capability token for the customer's manage link. 256 bits, minted by the database so
  -- a code path that forgets to generate one cannot create a guessable booking link.
  manage_token      text NOT NULL UNIQUE DEFAULT
                      encode(sha256((gen_random_uuid()::text || gen_random_uuid()::text)::bytea), 'hex'),

  cancelled_at      timestamptz,
  cancelled_by      text CHECK (cancelled_by IN ('customer', 'admin')),

  -- The owner's unseen-changes badge, without any time window.
  -- A customer-initiated write stamps last_customer_change_at; the owner acknowledging
  -- stamps owner_seen_at. Something needs attention when
  --   last_customer_change_at IS NOT NULL
  --   AND (owner_seen_at IS NULL OR owner_seen_at < last_customer_change_at).
  -- The salon app used a nightly window instead and lost every cancellation that landed
  -- between the evening run and midnight; widening the window then double-reported.
  last_customer_change_at timestamptz,
  owner_seen_at           timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bookings_ordered CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS bookings_business_starts_idx ON torim.bookings (business_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_business_blocks_idx ON torim.bookings (business_id, blocks_from, blocks_until)
  WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON torim.bookings (business_id, customer_id);

-- ---------------------------------------------------------------------------
-- Keep the occupied interval in step with the appointment and its buffers.
-- A BEFORE trigger rather than application code, so no write path can forget.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION torim.bookings_set_blocking_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.blocks_from  := NEW.starts_at - (NEW.buffer_before_min * INTERVAL '1 minute');
  NEW.blocks_until := NEW.ends_at   + (NEW.buffer_after_min  * INTERVAL '1 minute');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_blocking_window ON torim.bookings;
CREATE TRIGGER bookings_blocking_window
  BEFORE INSERT OR UPDATE OF starts_at, ends_at, buffer_before_min, buffer_after_min
  ON torim.bookings
  FOR EACH ROW EXECUTE FUNCTION torim.bookings_set_blocking_window();

-- ---------------------------------------------------------------------------
-- notifications — what an external transport should send, if one is configured.
--
-- v1 has no retry/backoff, no quiet hours, no debounce and no delivery-status UI: the
-- product must work with this table never being drained at all. Owner-initiated wa.me
-- deep links are the default channel and do not appear here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES torim.bookings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('booking_confirmed', 'booking_cancelled', 'reminder')),
  channel     text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  locale      text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'he')),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  send_after  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Idempotency at send granularity: one notification of a given kind+channel per
  -- booking, so a re-run cannot double-send.
  UNIQUE (booking_id, kind, channel)
);

CREATE INDEX IF NOT EXISTS notifications_due_idx ON torim.notifications (business_id, status, send_after);

-- ---------------------------------------------------------------------------
-- Row-level security for every tenant-scoped table.
--
-- FORCE matters: without it the policy is skipped for the table owner, so migrations run
-- as owner would silently see everything and any future owner-connected code path would
-- leak. It does NOT protect against a superuser or a BYPASSRLS role — Postgres skips RLS
-- for those with no error at all, which is why the app role is asserted in CI.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['services', 'working_hours', 'closures', 'customers', 'bookings', 'notifications']
  LOOP
    EXECUTE format('ALTER TABLE torim.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE torim.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON torim.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON torim.%I
        USING      (business_id = nullif(current_setting('torim.business_id', true), '')::uuid)
        WITH CHECK (business_id = nullif(current_setting('torim.business_id', true), '')::uuid)
    $p$, t);
    EXECUTE format($p$
      ALTER TABLE torim.%I ALTER COLUMN business_id
        SET DEFAULT nullif(current_setting('torim.business_id', true), '')::uuid
    $p$, t);
  END LOOP;
END $$;
