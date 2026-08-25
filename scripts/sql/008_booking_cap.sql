-- 008 — a cap on how many future bookings one customer may hold.
--
-- The public booking surface is unauthenticated by design: name and phone, no account,
-- no verification. Rate limiting bounds how FAST an attacker works; nothing bounded how
-- MUCH they could hold. A red-team walk-through filled a business's entire 60-day
-- horizon — roughly 960 slots — with one request each, incrementing the phone number
-- every time so the per-phone limiter never fired. `confirm_new_customers` does not
-- help: pending bookings occupy their slot, so the calendar is just as dead while the
-- owner triages a thousand fabricated customers.
--
-- Per-business rather than a constant, because a physiotherapist with a weekly standing
-- appointment and a barber are different businesses. The default is deliberately
-- generous enough that no ordinary customer meets it.
ALTER TABLE torim.businesses
  ADD COLUMN IF NOT EXISTS max_future_bookings_per_customer integer NOT NULL DEFAULT 5;

ALTER TABLE torim.businesses DROP CONSTRAINT IF EXISTS businesses_future_bookings_range;
ALTER TABLE torim.businesses ADD CONSTRAINT businesses_future_bookings_range
  CHECK (max_future_bookings_per_customer BETWEEN 1 AND 100);

-- The cap is counted per customer over live future bookings, so that is the lookup.
CREATE INDEX IF NOT EXISTS bookings_customer_future_idx
  ON torim.bookings (business_id, customer_id, starts_at)
  WHERE status IN ('pending', 'confirmed');
