/**
 * What a booking event puts on the queue.
 *
 * `channels` is what the configured transport can actually deliver, so a deployment with
 * only email never accumulates a backlog of undeliverable WhatsApp messages, and one with
 * no transport at all (the default) queues nothing whatsoever.
 */
import { query } from '../db';
import type { Channel, NotificationKind } from './types';
import { enqueue } from './queue';
import type { Lang } from '../i18n';

export type BookingEvent = 'created' | 'cancelled';

export type ScheduleArgs = {
  bookingId: string;
  event: BookingEvent;
  /** Channels the configured transport claims. Empty means nothing is queued. */
  channels: readonly Channel[];
  now?: Date;
};

type BookingRow = {
  starts_at: Date;
  default_locale: Lang;
  reminder_lead_min: number | null;
};

export async function scheduleForBooking(args: ScheduleArgs): Promise<string[]> {
  const { bookingId, event, channels } = args;
  const now = args.now ?? new Date();

  if (channels.length === 0) return [];

  const rows = await query<BookingRow>(
    `SELECT b.starts_at, s.default_locale, s.reminder_lead_min
       FROM torim.bookings b
       JOIN torim.businesses s ON s.id = b.business_id
      WHERE b.id = $1`,
    [bookingId],
  );
  const booking = rows[0];
  if (!booking) return [];

  const locale = booking.default_locale;
  const queued: string[] = [];

  const immediateKind: NotificationKind =
    event === 'created' ? 'booking_confirmed' : 'booking_cancelled';

  for (const channel of channels) {
    const id = await enqueue({ bookingId, kind: immediateKind, channel, locale, sendAfter: now });
    if (id) queued.push(id);
  }

  // A cancellation has no future reminder to schedule, and its own pending ones are
  // dropped separately.
  if (event !== 'created') return queued;

  // NULL means this business does not want reminders — different from "0 minutes before".
  if (booking.reminder_lead_min === null) return queued;

  const remindAt = new Date(booking.starts_at.getTime() - booking.reminder_lead_min * 60_000);

  // A reminder whose moment has already passed is noise, not a late reminder: the point
  // of "the day before" is the day before.
  if (remindAt.getTime() <= now.getTime()) return queued;

  for (const channel of channels) {
    const id = await enqueue({ bookingId, kind: 'reminder', channel, locale, sendAfter: remindAt });
    if (id) queued.push(id);
  }

  return queued;
}
