/**
 * What happens to the queue when a booking changes.
 *
 * Called from the booking write paths rather than from their callers, so no new code
 * path can forget — in particular, forget to drop a pending reminder when an appointment
 * is cancelled, which is the failure a real business would be embarrassed by: a reminder
 * arriving the night before for an appointment the customer already called off.
 *
 * Two properties this depends on:
 *
 *  1. It runs AFTER the booking transaction has committed. The queue writes on their own
 *     connection, so an uncommitted booking would not be visible to them.
 *  2. It never throws. A messaging problem must not fail a booking — the product is
 *     designed to work with no transport configured at all, which is the default.
 */
import { resolveTransport } from './registry';
import { dropPendingForBooking } from './queue';
import { scheduleForBooking } from './schedule';
import type { Channel } from './types';

/** Channels the configured transport can deliver. Empty by default — `none` claims none. */
function configuredChannels(override?: readonly Channel[]): readonly Channel[] {
  if (override) return override;
  try {
    return resolveTransport().channels;
  } catch {
    // A misconfigured TORIM_TRANSPORT is loud at startup, not here. Queueing nothing is
    // the safe reading in the middle of someone's booking.
    return [];
  }
}

type Options = { channels?: readonly Channel[]; now?: Date };

async function quietly(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[torim:notify] ${what} failed:`, error);
  }
}

export async function afterBookingCreated(bookingId: string, options: Options = {}): Promise<void> {
  const channels = configuredChannels(options.channels);
  if (channels.length === 0) return;

  await quietly('scheduling notifications for a new booking', () =>
    scheduleForBooking({ bookingId, event: 'created', channels, now: options.now }),
  );
}

export async function afterBookingCancelled(bookingId: string, options: Options = {}): Promise<void> {
  // Drop first, and unconditionally: pending reminders must go even on a deployment with
  // no transport, because one may be configured before they come due.
  await quietly('dropping pending notifications for a cancelled booking', () =>
    dropPendingForBooking(bookingId),
  );

  const channels = configuredChannels(options.channels);
  if (channels.length === 0) return;

  await quietly('scheduling a cancellation notice', () =>
    scheduleForBooking({ bookingId, event: 'cancelled', channels, now: options.now }),
  );
}

/**
 * A moved appointment keeps its confirmation — the customer was told, and that happened —
 * but its reminder was scheduled against the old time and is now wrong. Drop and reschedule.
 */
export async function afterBookingRescheduled(bookingId: string, options: Options = {}): Promise<void> {
  await quietly('dropping notifications for a moved booking', () => dropPendingForBooking(bookingId));

  const channels = configuredChannels(options.channels);
  if (channels.length === 0) return;

  await quietly('rescheduling the reminder', () =>
    scheduleForBooking({ bookingId, event: 'created', channels, now: options.now }),
  );
}
