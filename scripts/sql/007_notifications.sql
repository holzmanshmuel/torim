-- 007 — what the notification layer needs.
--
-- Torim ships with NO messaging provider. A fresh clone sends nothing and requires an
-- account with nobody; a deployment chooses a transport in its own env and supplies its
-- own credentials. These columns are the per-business half of that.

-- ---------------------------------------------------------------------------
-- reminder_lead_min — how far ahead a reminder is due.
--
-- NULL means this business does not want reminders at all, which is different from
-- "0 minutes before". A nullable integer says that; a NOT NULL DEFAULT 0 could not.
-- ---------------------------------------------------------------------------
ALTER TABLE torim.businesses
  ADD COLUMN IF NOT EXISTS reminder_lead_min integer;

ALTER TABLE torim.businesses DROP CONSTRAINT IF EXISTS businesses_reminder_lead_range;
ALTER TABLE torim.businesses ADD CONSTRAINT businesses_reminder_lead_range
  CHECK (reminder_lead_min IS NULL OR reminder_lead_min BETWEEN 0 AND 20160);

-- ---------------------------------------------------------------------------
-- ask_customer_email — off by default, deliberately.
--
-- Phone is the customer's identity in Torim and the booking form asks for nothing else.
-- Email is only worth collecting if the business can actually send one, and most
-- deployments will run with no transport configured at all. Collecting an address you
-- will never use is a privacy cost with no benefit, and it would make the form's
-- collection notice inaccurate.
-- ---------------------------------------------------------------------------
ALTER TABLE torim.businesses
  ADD COLUMN IF NOT EXISTS ask_customer_email boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- notifications: room for a transport to report back.
--
-- 'skipped' is a real outcome, not a failure: a booking whose customer has no email
-- while the only configured transport is email was never sendable. Recording it as
-- failed would invite retries of something that can never succeed.
-- ---------------------------------------------------------------------------
ALTER TABLE torim.notifications
  ADD COLUMN IF NOT EXISTS transport text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE torim.notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE torim.notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));

-- 'sms' so a transport can carry one without a migration; nothing in-repo sends it.
ALTER TABLE torim.notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE torim.notifications ADD CONSTRAINT notifications_channel_check
  CHECK (channel IN ('email', 'whatsapp', 'sms'));

-- Draining the queue always asks the same question: what is due, oldest first.
CREATE INDEX IF NOT EXISTS notifications_queued_due_idx
  ON torim.notifications (business_id, send_after)
  WHERE status = 'queued';
