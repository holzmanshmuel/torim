-- 003 — per-date working hours.
--
-- A closure says "shut at this time on this date". This says "these are the hours on
-- this date instead of the usual ones" — opening on a normally-closed Sunday, or
-- working a one-off short day.
--
-- The override REPLACES the weekly template for its date rather than adding to it.
-- Merging the two would make "open 14:00–17:00 today instead of the usual 09:00–17:00"
-- inexpressible, and shortening a single day is far more common than extending one.
-- Several rows on one date express breaks, exactly as torim.working_hours does.
--
-- Closures still apply on top, so a date can be overridden and then shut.

CREATE TABLE IF NOT EXISTS torim.date_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES torim.businesses(id) ON DELETE CASCADE,
  on_date     date NOT NULL,
  start_min   integer NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min     integer NOT NULL CHECK (end_min   BETWEEN 1 AND 1440),
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Same reasoning as torim.working_hours: a window ending before it starts blocks
  -- nothing while reading as valid to a human.
  CONSTRAINT date_overrides_ordered CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS date_overrides_business_date_idx
  ON torim.date_overrides (business_id, on_date);

-- RLS, matching every other tenant-scoped table (see 002 for why FORCE matters).
ALTER TABLE torim.date_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE torim.date_overrides FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON torim.date_overrides;
CREATE POLICY tenant_isolation ON torim.date_overrides
  USING      (business_id = nullif(current_setting('torim.business_id', true), '')::uuid)
  WITH CHECK (business_id = nullif(current_setting('torim.business_id', true), '')::uuid);
ALTER TABLE torim.date_overrides ALTER COLUMN business_id
  SET DEFAULT nullif(current_setting('torim.business_id', true), '')::uuid;

-- GRANTS: the app role's table grants were issued with GRANT ... ON ALL TABLES, which
-- does not cover tables created later. Re-run `npm run db:grant` after this migration.
