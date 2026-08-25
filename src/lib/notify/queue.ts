/**
 * The notification queue.
 *
 * Torim never sends on its own schedule. It records what is due; a transport or an
 * external system through the ops endpoints drains it. That keeps the product fully
 * usable with no messaging configured at all, which is the default and the collapse mode
 * that matters.
 *
 * Idempotency is a database constraint, not a code convention: UNIQUE(booking_id, kind,
 * channel) means a retried request, a double-tap or a replayed webhook cannot produce a
 * second confirmation to a real person.
 */
import { query } from '../db';
import type { Lang } from '../i18n';
import type { Channel, NotificationKind } from './types';

export type QueuedNotification = {
  id: string;
  businessId: string;
  bookingId: string | null;
  kind: NotificationKind;
  channel: Channel;
  locale: Lang;
  payload: Record<string, unknown>;
  sendAfter: Date;
  attempts: number;
};

type Row = {
  id: string;
  business_id: string;
  booking_id: string | null;
  kind: NotificationKind;
  channel: Channel;
  locale: Lang;
  payload: Record<string, unknown>;
  send_after: Date;
  attempts: number;
};

const COLUMNS = 'id, business_id, booking_id, kind, channel, locale, payload, send_after, attempts';

function toQueued(row: Row): QueuedNotification {
  return {
    id: row.id,
    businessId: row.business_id,
    bookingId: row.booking_id,
    kind: row.kind,
    channel: row.channel,
    locale: row.locale,
    payload: row.payload,
    sendAfter: row.send_after,
    attempts: row.attempts,
  };
}

export type EnqueueArgs = {
  bookingId: string;
  kind: NotificationKind;
  channel: Channel;
  locale: Lang;
  sendAfter: Date;
  payload?: Record<string, unknown>;
};

/** Returns the new id, or null when this exact notification was already queued. */
export async function enqueue(args: EnqueueArgs): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `INSERT INTO torim.notifications (booking_id, kind, channel, locale, payload, send_after)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (booking_id, kind, channel) DO NOTHING
     RETURNING id`,
    [args.bookingId, args.kind, args.channel, args.locale, args.payload ?? {}, args.sendAfter],
  );
  return rows[0]?.id ?? null;
}

/** What is queued and actually due, oldest first. Tenant-scoped by RLS. */
export async function listDue(args: { now?: Date; limit?: number } = {}): Promise<QueuedNotification[]> {
  const now = args.now ?? new Date();
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 500);

  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM torim.notifications
      WHERE status = 'queued' AND send_after <= $1
      ORDER BY send_after, created_at
      LIMIT $2`,
    [now, limit],
  );
  return rows.map(toQueued);
}

/**
 * All three marks return whether a row actually changed.
 *
 * Under RLS a wrong (id, tenant) pair updates nothing rather than erroring, so silence
 * is indistinguishable from success — and a caller told "ok" leaves the row queued to be
 * handed out and sent a second time.
 */
export async function markSent(id: string, transport: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.notifications
        SET status = 'sent', transport = $2, sent_at = now(), attempts = attempts + 1,
            last_error = NULL
      WHERE id = $1
      RETURNING id`,
    [id, transport],
  );
  return rows.length > 0;
}

export async function markFailed(
  id: string,
  transport: string,
  error: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.notifications
        SET status = 'failed', transport = $2, last_error = $3, attempts = attempts + 1
      WHERE id = $1
      RETURNING id`,
    [id, transport, error.slice(0, 2000)],
  );
  return rows.length > 0;
}

/**
 * Never sendable rather than not sent yet.
 *
 * Deliberately does NOT count an attempt: a customer with no email address on an
 * email-only deployment will never become sendable, and an attempt counter is for
 * deciding whether to try again.
 */
export async function markSkipped(
  id: string,
  transport: string,
  reason: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.notifications
        SET status = 'skipped', transport = $2, last_error = $3
      WHERE id = $1
      RETURNING id`,
    [id, transport, reason.slice(0, 2000)],
  );
  return rows.length > 0;
}

/**
 * Drop anything still waiting to go out for a booking.
 *
 * Call this when a booking is cancelled or moved. The failure it prevents is the one a
 * real business would be embarrassed by: a reminder the night before, for an appointment
 * the customer already cancelled.
 *
 * Only touches `queued` rows. What was already sent stays as a record of what the
 * customer actually received.
 */
export async function dropPendingForBooking(bookingId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `DELETE FROM torim.notifications
      WHERE booking_id = $1 AND status = 'queued'
      RETURNING id`,
    [bookingId],
  );
  return rows.length;
}
