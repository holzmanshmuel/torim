/**
 * The notification queue.
 *
 * Torim does not send anything itself on a schedule — it records what is due and lets a
 * transport, or an external system through the ops endpoints, drain it. So the rules
 * that matter here are about not queueing things that can never be delivered, and not
 * delivering things that have stopped being true.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelBooking, createBooking } from '../booking';
import { query, systemQueryOne } from '../db';
import { runWithTenant } from '../tenant';
import { startTestTransaction, type TestDatabase } from '../test-db';
import { localToInstant } from '../time';
import {
  dropPendingForBooking,
  enqueue,
  listDue,
  markFailed,
  markSent,
  markSkipped,
} from './queue';
import { scheduleForBooking } from './schedule';

const TZ = 'Asia/Jerusalem';
const DAY = '2026-09-14'; // a Monday
const at = (minutes: number, day = DAY) => localToInstant(day, minutes, TZ);

let db: TestDatabase;
let businessId: string;
let otherBusinessId: string;
let serviceId: string;
let customerId: string;

async function makeBooking(startMinutes: number, day = DAY): Promise<string> {
  const booking = await runWithTenant(businessId, () =>
    createBooking({
      businessId,
      customerId,
      serviceId,
      startsAt: at(startMinutes, day),
      source: 'customer',
      allowOverlap: true,
    }),
  );
  return booking.id;
}

beforeAll(async () => {
  db = await startTestTransaction();

  const b = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency, default_calling_code,
                                   reminder_lead_min, ask_customer_email)
     VALUES ('notify-test', 'Notify Test', $1, 'ILS', '972', 1440, true) RETURNING id`,
    [TZ],
  );
  businessId = b!.id;

  const o = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, timezone, currency)
     VALUES ('notify-other', 'Other', $1, 'ILS') RETURNING id`,
    [TZ],
  );
  otherBusinessId = o!.id;

  await runWithTenant(businessId, async () => {
    const s = await query<{ id: string }>(
      `INSERT INTO torim.services (name, duration_min, price_minor)
       VALUES ('Cut', 60, 12000) RETURNING id`,
    );
    serviceId = s[0]!.id;
    const c = await query<{ id: string }>(
      `INSERT INTO torim.customers (name, phone_e164, email)
       VALUES ('Ada', '+15550166001', 'ada@example.invalid') RETURNING id`,
    );
    customerId = c[0]!.id;
  });
});

afterAll(async () => {
  await db.rollback();
});

describe('enqueue', () => {
  it('records something due', async () => {
    const bookingId = await makeBooking(10 * 60);
    const id = await runWithTenant(businessId, () =>
      enqueue({
        bookingId,
        kind: 'booking_confirmed',
        channel: 'email',
        locale: 'en',
        sendAfter: at(9 * 60),
      }),
    );
    expect(id).toBeTruthy();
  });

  /**
   * The same booking event must not queue twice, however many times the code path runs.
   * A retried request, a double-tap, a replayed webhook — each is a second confirmation
   * email to a real person.
   */
  it('is idempotent per booking, kind and channel', async () => {
    const bookingId = await makeBooking(11 * 60);
    const args = {
      bookingId,
      kind: 'booking_confirmed' as const,
      channel: 'email' as const,
      locale: 'en' as const,
      sendAfter: at(9 * 60),
    };

    const first = await runWithTenant(businessId, () => enqueue(args));
    const second = await runWithTenant(businessId, () => enqueue(args));

    expect(first).toBeTruthy();
    expect(second).toBeNull();

    const rows = await runWithTenant(businessId, () =>
      query('SELECT id FROM torim.notifications WHERE booking_id = $1', [bookingId]),
    );
    expect(rows).toHaveLength(1);
  });

  it('allows the same booking on a different channel', async () => {
    const bookingId = await makeBooking(12 * 60);
    const base = { bookingId, kind: 'booking_confirmed' as const, locale: 'en' as const, sendAfter: at(9 * 60) };
    expect(await runWithTenant(businessId, () => enqueue({ ...base, channel: 'email' }))).toBeTruthy();
    expect(await runWithTenant(businessId, () => enqueue({ ...base, channel: 'whatsapp' }))).toBeTruthy();
  });
});

describe('listDue', () => {
  it('returns only what is queued and actually due', async () => {
    const bookingId = await makeBooking(13 * 60);
    await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'reminder', channel: 'email', locale: 'en', sendAfter: at(20 * 60) }),
    );

    const tooEarly = await runWithTenant(businessId, () => listDue({ now: at(19 * 60) }));
    expect(tooEarly.some((n) => n.bookingId === bookingId)).toBe(false);

    const due = await runWithTenant(businessId, () => listDue({ now: at(20 * 60 + 1) }));
    expect(due.some((n) => n.bookingId === bookingId)).toBe(true);
  });

  it('does not leak another business’s queue', async () => {
    const mine = await runWithTenant(businessId, () => listDue({ now: at(23 * 60) }));
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await runWithTenant(otherBusinessId, () => listDue({ now: at(23 * 60) }));
    expect(theirs).toEqual([]);
  });

  it('honours a limit, oldest first', async () => {
    const some = await runWithTenant(businessId, () => listDue({ now: at(23 * 60), limit: 2 }));
    expect(some.length).toBeLessThanOrEqual(2);
    const times = some.map((n) => n.sendAfter.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('reporting an outcome', () => {
  it('marks sent, with which transport did it', async () => {
    const bookingId = await makeBooking(14 * 60);
    const id = await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'booking_confirmed', channel: 'email', locale: 'en', sendAfter: at(9 * 60) }),
    );
    await runWithTenant(businessId, () => markSent(id!, 'smtp'));

    const rows = await runWithTenant(businessId, () =>
      query<{ status: string; transport: string; sent_at: Date | null }>(
        'SELECT status, transport, sent_at FROM torim.notifications WHERE id = $1',
        [id],
      ),
    );
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.transport).toBe('smtp');
    expect(rows[0]!.sent_at).not.toBeNull();
  });

  it('marks failed with the error and counts the attempt', async () => {
    const bookingId = await makeBooking(15 * 60);
    const id = await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'booking_confirmed', channel: 'email', locale: 'en', sendAfter: at(9 * 60) }),
    );
    await runWithTenant(businessId, () => markFailed(id!, 'smtp', 'connection refused'));

    const rows = await runWithTenant(businessId, () =>
      query<{ status: string; last_error: string; attempts: number }>(
        'SELECT status, last_error, attempts FROM torim.notifications WHERE id = $1',
        [id],
      ),
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.last_error).toBe('connection refused');
    expect(rows[0]!.attempts).toBe(1);
  });

  /**
   * Skipped is distinct from failed on purpose: a customer with no email address on an
   * email-only deployment was never sendable, and retrying it forever is noise.
   */
  it('marks skipped without counting it as a failure', async () => {
    const bookingId = await makeBooking(16 * 60);
    const id = await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'booking_confirmed', channel: 'email', locale: 'en', sendAfter: at(9 * 60) }),
    );
    await runWithTenant(businessId, () => markSkipped(id!, 'smtp', 'Recipient has no email address.'));

    const rows = await runWithTenant(businessId, () =>
      query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM torim.notifications WHERE id = $1',
        [id],
      ),
    );
    expect(rows[0]!.status).toBe('skipped');
    expect(rows[0]!.attempts).toBe(0);
  });

  it('a reported notification stops being due', async () => {
    const before = await runWithTenant(businessId, () => listDue({ now: at(23 * 60) }));
    const target = before[0]!;
    await runWithTenant(businessId, () => markSent(target.id, 'smtp'));
    const after = await runWithTenant(businessId, () => listDue({ now: at(23 * 60) }));
    expect(after.some((n) => n.id === target.id)).toBe(false);
  });
});

describe('scheduleForBooking', () => {
  it('queues a confirmation and a reminder at the business’s lead time', async () => {
    const bookingId = await makeBooking(10 * 60, '2026-09-21');
    await runWithTenant(businessId, () =>
      scheduleForBooking({ bookingId, event: 'created', channels: ['email'], now: at(9 * 60) }),
    );

    const rows = await runWithTenant(businessId, () =>
      query<{ kind: string; send_after: Date }>(
        'SELECT kind, send_after FROM torim.notifications WHERE booking_id = $1 ORDER BY send_after',
        [bookingId],
      ),
    );
    // Ordered by send_after: the confirmation is due now, the reminder a week later.
    expect(rows.map((r) => r.kind)).toEqual(['booking_confirmed', 'reminder']);

    // reminder_lead_min is 1440, so a day before the 10:00 appointment.
    const reminder = rows.find((r) => r.kind === 'reminder')!;
    expect(reminder.send_after.getTime()).toBe(at(10 * 60, '2026-09-20').getTime());
  });

  it('queues nothing for a channel no transport can deliver', async () => {
    const bookingId = await makeBooking(11 * 60, '2026-09-21');
    await runWithTenant(businessId, () =>
      scheduleForBooking({ bookingId, event: 'created', channels: [], now: at(9 * 60) }),
    );
    const rows = await runWithTenant(businessId, () =>
      query('SELECT id FROM torim.notifications WHERE booking_id = $1', [bookingId]),
    );
    expect(rows).toEqual([]);
  });

  it('skips the reminder when its moment has already passed', async () => {
    const bookingId = await makeBooking(12 * 60, '2026-09-21');
    // "Now" is already past the day-before mark.
    await runWithTenant(businessId, () =>
      scheduleForBooking({ bookingId, event: 'created', channels: ['email'], now: at(9 * 60, '2026-09-21') }),
    );
    const rows = await runWithTenant(businessId, () =>
      query<{ kind: string }>('SELECT kind FROM torim.notifications WHERE booking_id = $1', [bookingId]),
    );
    expect(rows.map((r) => r.kind)).toEqual(['booking_confirmed']);
  });

  it('queues no reminder at all when the business has not asked for one', async () => {
    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET reminder_lead_min = NULL WHERE id = $1', [businessId]),
    );
    const bookingId = await makeBooking(13 * 60, '2026-09-21');
    await runWithTenant(businessId, () =>
      scheduleForBooking({ bookingId, event: 'created', channels: ['email'], now: at(9 * 60) }),
    );
    const rows = await runWithTenant(businessId, () =>
      query<{ kind: string }>('SELECT kind FROM torim.notifications WHERE booking_id = $1', [bookingId]),
    );
    expect(rows.map((r) => r.kind)).toEqual(['booking_confirmed']);

    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET reminder_lead_min = 1440 WHERE id = $1', [businessId]),
    );
  });
});

describe('a cancelled booking', () => {
  /**
   * The one that would embarrass a real business: a reminder for an appointment the
   * customer already cancelled, arriving the night before.
   */
  it('never sends its pending reminder', async () => {
    const bookingId = await makeBooking(14 * 60, '2026-09-28');
    await runWithTenant(businessId, () =>
      scheduleForBooking({ bookingId, event: 'created', channels: ['email'], now: at(9 * 60) }),
    );

    const queuedBefore = await runWithTenant(businessId, () =>
      query<{ kind: string }>(
        `SELECT kind FROM torim.notifications WHERE booking_id = $1 AND status = 'queued'`,
        [bookingId],
      ),
    );
    expect(queuedBefore.map((r) => r.kind)).toContain('reminder');

    // No explicit cleanup call: cancelBooking drops pending notifications itself, so a
    // new code path cannot forget to. That is the whole point — this is the failure a
    // real business would be embarrassed by.
    await runWithTenant(businessId, () =>
      cancelBooking({ bookingId, by: 'customer', now: at(9 * 60, '2026-09-20') }),
    );

    const stillQueued = await runWithTenant(businessId, () =>
      query(
        `SELECT id FROM torim.notifications WHERE booking_id = $1 AND status = 'queued'`,
        [bookingId],
      ),
    );
    expect(stillQueued).toEqual([]);
  });

  it('leaves what was already sent alone, as a record of what the customer received', async () => {
    const bookingId = await makeBooking(15 * 60, '2026-09-28');
    const id = await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'booking_confirmed', channel: 'email', locale: 'en', sendAfter: at(9 * 60) }),
    );
    await runWithTenant(businessId, () => markSent(id!, 'smtp'));
    await runWithTenant(businessId, () => dropPendingForBooking(bookingId));

    const rows = await runWithTenant(businessId, () =>
      query<{ status: string }>('SELECT status FROM torim.notifications WHERE id = $1', [id]),
    );
    expect(rows[0]!.status).toBe('sent');
  });
});

/**
 * Reporting an outcome for a notification that isn't there.
 *
 * RLS makes a wrong (id, businessId) pair update zero rows rather than error. If the
 * caller is told "ok" anyway, an external drainer that sent the message and then
 * reported the wrong tenant is told it succeeded, the row stays queued, the next poll
 * hands it out again — and the customer receives a second copy, carrying the same
 * capability URL.
 */
describe('marking a notification that does not match', () => {
  it('reports that nothing was updated rather than silently succeeding', async () => {
    const absent = '00000000-0000-0000-0000-0000000000ff';
    expect(await runWithTenant(businessId, () => markSent(absent, 'smtp'))).toBe(false);
    expect(await runWithTenant(businessId, () => markFailed(absent, 'smtp', 'x'))).toBe(false);
    expect(await runWithTenant(businessId, () => markSkipped(absent, 'smtp', 'x'))).toBe(false);
  });

  it('reports success when the row really was updated', async () => {
    const bookingId = await makeBooking(17 * 60);
    const id = await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'booking_confirmed', channel: 'email', locale: 'en', sendAfter: at(9 * 60) }),
    );
    expect(await runWithTenant(businessId, () => markSent(id!, 'smtp'))).toBe(true);
  });

  it('reports a miss when the notification belongs to another tenant', async () => {
    const bookingId = await makeBooking(18 * 60);
    const id = await runWithTenant(businessId, () =>
      enqueue({ bookingId, kind: 'booking_confirmed', channel: 'email', locale: 'en', sendAfter: at(9 * 60) }),
    );
    // Correct id, wrong tenant — exactly the drainer mistake this guards.
    expect(await runWithTenant(otherBusinessId, () => markSent(id!, 'smtp'))).toBe(false);
  });
});
