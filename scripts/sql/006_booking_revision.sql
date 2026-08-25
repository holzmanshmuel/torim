-- 006 — a monotonic revision counter per booking.
--
-- Exists for iCal SEQUENCE. RFC 5545 requires it to increase with every revision of an
-- event; a client is entitled to ignore an update whose SEQUENCE has not advanced and
-- leave the stale time in the user's calendar.
--
-- The two obvious shortcuts both fail:
--   * a constant 0 means no update is ever honoured;
--   * deriving it from the appointment's start time advances when a booking moves later
--     and goes BACKWARDS when it moves earlier — so "your appointment is an hour earlier"
--     is precisely the update a strict client discards.
--
-- updated_at would work but is a timestamp: turning it into the integer SEQUENCE wants
-- means epoch seconds, which overflows a signed 32-bit field in 2038. A counter is
-- monotonic by construction and cannot overflow in any realistic life of a booking.
ALTER TABLE torim.bookings
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
