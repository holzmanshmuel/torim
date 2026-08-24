-- 001 — tenancy.
--
-- businesses / users / memberships are deliberately NOT under RLS. They have to be
-- readable *before* a tenant context exists: resolving a public booking slug, signing
-- a user in, and onboarding an owner who has no business yet. Everything else in the
-- schema is tenant-scoped (see 002).
--
-- Reached only through the systemQuery()/withSystemTransaction() path in src/lib/db.ts.

CREATE SCHEMA IF NOT EXISTS torim;

-- ---------------------------------------------------------------------------
-- businesses — the tenant table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.businesses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE
                            CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  name                    text NOT NULL CHECK (length(btrim(name)) > 0),
  name_he                 text,

  -- Timezone is NOT NULL with no default on purpose. Every slot calculation runs in
  -- business-local time; silently defaulting to UTC would produce a booking system
  -- that is quietly an hour or three wrong and never errors.
  timezone                text NOT NULL,

  default_locale          text NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en', 'he')),
  currency                text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- Booking policy. Config, never constants.
  slot_granularity_min    integer NOT NULL DEFAULT 15  CHECK (slot_granularity_min BETWEEN 1 AND 240),
  min_notice_min          integer NOT NULL DEFAULT 120 CHECK (min_notice_min >= 0),
  max_advance_days        integer NOT NULL DEFAULT 60  CHECK (max_advance_days BETWEEN 1 AND 730),
  cancellation_window_min integer NOT NULL DEFAULT 1440 CHECK (cancellation_window_min >= 0),

  -- When true, a booking from a customer we have never seen lands as 'pending' and the
  -- owner confirms it. This is the abuse control that stands in for SMS verification.
  confirm_new_customers   boolean NOT NULL DEFAULT false,

  -- E.164. Where the owner-initiated wa.me deep links open.
  owner_whatsapp_phone    text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users — people who sign in to administer a business (Google OAuth).
-- Customers are NOT users; they never get an account (see torim.customers).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  text NOT NULL UNIQUE,
  email       text NOT NULL,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- memberships — which user may administer which business, and how.
-- A user may hold several; the session's active business is just the current one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS torim.memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES torim.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS memberships_business_idx ON torim.memberships (business_id);

-- ---------------------------------------------------------------------------
-- create_business_with_owner — the ONE legitimate cross-tenant write.
--
-- Onboarding is the chicken-and-egg case: a signed-in user with no business needs to
-- create one, so there is no tenant context to scope to yet. Rather than granting the
-- app role an ambient RLS bypass, that capability is confined to this one function.
-- SECURITY DEFINER runs it as the owner; EXECUTE is granted only to the app role
-- (see scripts/grant-app-role.ts).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION torim.create_business_with_owner(
  p_user_id  uuid,
  p_slug     text,
  p_name     text,
  p_timezone text,
  p_currency text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = torim, pg_temp
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  INSERT INTO torim.businesses (slug, name, timezone, currency)
  VALUES (p_slug, p_name, p_timezone, p_currency)
  RETURNING id INTO v_business_id;

  INSERT INTO torim.memberships (user_id, business_id, role)
  VALUES (p_user_id, v_business_id, 'owner');

  RETURN v_business_id;
END;
$$;

REVOKE ALL ON FUNCTION torim.create_business_with_owner(uuid, text, text, text, text) FROM PUBLIC;
