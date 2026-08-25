-- 004 — what the public booking surface needs.
--
-- Two additions, both driven by the fact that a customer arrives with no account, no
-- session, and therefore no tenant context.

-- ---------------------------------------------------------------------------
-- default_calling_code — so a customer can type a local number.
--
-- Phone IS the customer's identity here, so "050-123-4567" and "+972 50 123 4567" have
-- to resolve to the same person or a returning customer silently becomes a second
-- record and her history disappears. Resolving a local number requires knowing the
-- country, and that is business configuration, not a constant in the code.
--
-- Nullable on purpose: a business that leaves it unset simply requires customers to
-- type a full international number. Guessing a country would be worse than asking.
-- ---------------------------------------------------------------------------
ALTER TABLE torim.businesses
  ADD COLUMN IF NOT EXISTS default_calling_code text;

ALTER TABLE torim.businesses DROP CONSTRAINT IF EXISTS businesses_calling_code_shape;
ALTER TABLE torim.businesses ADD CONSTRAINT businesses_calling_code_shape
  CHECK (default_calling_code IS NULL OR default_calling_code ~ '^[1-9][0-9]{0,3}$');

-- ---------------------------------------------------------------------------
-- business_for_manage_token — the second legitimate cross-tenant read.
--
-- A booking-management link is a capability URL: the token IS the credential. To honour
-- it we must find which tenant it belongs to, and that lookup necessarily happens before
-- any tenant context exists. RLS correctly hides torim.bookings from an unscoped
-- connection, so rather than weakening that, this SECURITY DEFINER function is the one
-- narrow hole — and it returns ONLY the business id. Everything else about the booking
-- is then read normally, under RLS, once the tenant scope is entered.
--
-- It deliberately reveals nothing else: an attacker guessing tokens learns at most
-- whether a token exists, and the token is 256 bits of randomness.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION torim.business_for_manage_token(p_token text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = torim, pg_temp
AS $$
  SELECT business_id FROM torim.bookings WHERE manage_token = p_token;
$$;

REVOKE ALL ON FUNCTION torim.business_for_manage_token(text) FROM PUBLIC;

-- GRANTS: the app role needs EXECUTE on the new function and SELECT/UPDATE on the new
-- column. `GRANT ... ON ALL TABLES` from the initial grant does not cover a function,
-- so `npm run db:grant` must be re-run after this migration.
