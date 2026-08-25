/**
 * Turning a queued row into something a transport can send.
 *
 * Message text lives here rather than in the app's dictionaries because the ops
 * endpoints render without a request, a locale cookie or a React tree — and because
 * `src/lib` must not depend on `src/app`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBooking } from '../booking';
import { query, systemQueryOne } from '../db';
import { runWithTenant } from '../tenant';
import { startTestTransaction, type TestDatabase } from '../test-db';
import { localToInstant } from '../time';
import { renderMessage } from './messages';
import { enqueue, listDue } from './queue';

const TZ = 'Asia/Jerusalem';
const DAY = '2026-10-12';
const at = (m: number, day = DAY) => localToInstant(day, m, TZ);

let db: TestDatabase;
let businessId: string;
let serviceId: string;
let withEmail: string;
let withoutEmail: string;

beforeAll(async () => {
  db = await startTestTransaction();
  const b = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses (slug, name, name_he, timezone, currency, default_calling_code)
     VALUES ('msg-test', 'Cedar Studio', 'סטודיו ארז', $1, 'ILS', '972') RETURNING id`,
    [TZ],
  );
  businessId = b!.id;

  await runWithTenant(businessId, async () => {
    const s = await query<{ id: string }>(
      `INSERT INTO torim.services (name, name_he, duration_min, price_minor)
       VALUES ('Haircut', 'תספורת', 30, 12000) RETURNING id`,
    );
    serviceId = s[0]!.id;
    const c = await query<{ id: string }>(
      `INSERT INTO torim.customers (name, phone_e164, email)
       VALUES ('Ada Lovelace', '+15550188001', 'ada@example.invalid'),
              ('Grace Hopper', '+15550188002', NULL) RETURNING id`,
    );
    withEmail = c[0]!.id;
    withoutEmail = c[1]!.id;
  });
});

afterAll(async () => {
  await db.rollback();
});

async function queueFor(customerId: string, locale: 'en' | 'he', kind: 'booking_confirmed' | 'reminder') {
  const booking = await runWithTenant(businessId, () =>
    createBooking({
      businessId,
      customerId,
      serviceId,
      startsAt: at(10 * 60),
      source: 'customer',
      allowOverlap: true,
    }),
  );
  const id = await runWithTenant(businessId, () =>
    enqueue({ bookingId: booking.id, kind, channel: 'email', locale, sendAfter: at(9 * 60) }),
  );
  const due = await runWithTenant(businessId, () => listDue({ now: at(9 * 60 + 1), limit: 500 }));
  return due.find((n) => n.id === id)!;
}

describe('renderMessage', () => {
  it('carries the facts a customer needs, in English', async () => {
    const queued = await queueFor(withEmail, 'en', 'booking_confirmed');
    const message = await runWithTenant(businessId, () => renderMessage(queued));

    expect(message).not.toBeNull();
    expect(message!.to.name).toBe('Ada Lovelace');
    expect(message!.to.email).toBe('ada@example.invalid');
    expect(message!.to.phone).toBe('+15550188001');
    expect(message!.subject).toContain('Cedar Studio');
    expect(message!.body).toContain('Haircut');
    expect(message!.body).toContain('10:00');
  });

  it('uses the business’s Hebrew names when the locale is Hebrew', async () => {
    const queued = await queueFor(withEmail, 'he', 'booking_confirmed');
    const message = await runWithTenant(businessId, () => renderMessage(queued));

    expect(message!.subject).toContain('סטודיו ארז');
    expect(message!.body).toContain('תספורת');
  });

  it('says something different for a reminder than for a confirmation', async () => {
    const confirmed = await queueFor(withEmail, 'en', 'booking_confirmed');
    const reminder = await queueFor(withEmail, 'en', 'reminder');

    const a = await runWithTenant(businessId, () => renderMessage(confirmed));
    const b = await runWithTenant(businessId, () => renderMessage(reminder));

    expect(a!.body).not.toBe(b!.body);
    expect(b!.body.toLowerCase()).toMatch(/remind|tomorrow|coming up/);
  });

  /**
   * The management link is the customer's only way back in, so every message carries it.
   */
  it('includes the booking’s own management link', async () => {
    const queued = await queueFor(withEmail, 'en', 'booking_confirmed');
    const message = await runWithTenant(businessId, () => renderMessage(queued));
    expect(message!.body).toMatch(/\/manage\/[0-9a-f]{64}/);
  });

  it('gives a transport the same facts as structured data', async () => {
    const queued = await queueFor(withEmail, 'en', 'booking_confirmed');
    const message = await runWithTenant(businessId, () => renderMessage(queued));

    expect(message!.data).toMatchObject({
      businessName: 'Cedar Studio',
      serviceName: 'Haircut',
      customerName: 'Ada Lovelace',
    });
    expect(typeof message!.data.startsAt).toBe('string');
  });

  /**
   * A customer with no email is not an error — most businesses never ask for one. The
   * message still renders; the transport decides it cannot deliver and marks it skipped.
   */
  it('renders for a customer with no email, leaving the address null', async () => {
    const queued = await queueFor(withoutEmail, 'en', 'booking_confirmed');
    const message = await runWithTenant(businessId, () => renderMessage(queued));
    expect(message).not.toBeNull();
    expect(message!.to.email).toBeNull();
  });

  it('returns null when the booking has gone', async () => {
    const queued = await queueFor(withEmail, 'en', 'booking_confirmed');
    await runWithTenant(businessId, () =>
      query('DELETE FROM torim.bookings WHERE id = $1', [queued.bookingId]),
    );
    expect(await runWithTenant(businessId, () => renderMessage(queued))).toBeNull();
  });
});
