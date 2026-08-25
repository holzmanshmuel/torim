/**
 * The public booking write path, against real Postgres.
 *
 * This is an unauthenticated write surface: no account, no verification, just a name and
 * a phone number. Everything here is about what must NOT be possible from that surface.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CustomerBlockedError,
  SlotNotAvailableError,
  bookPublicly,
} from './public-booking';
import {
  cancelByManageToken,
  findBookingByManageToken,
  rescheduleByManageToken,
} from './manage';
import { query, systemQueryOne } from './db';
import { runWithTenant } from './tenant';
import { startTestTransaction, type TestDatabase } from './test-db';
import { localToInstant } from './time';

const TZ = 'Asia/Jerusalem';
const MONDAY = '2026-06-15';
const at = (minutes: number, day = MONDAY) => localToInstant(day, minutes, TZ);
const EARLY = at(8 * 60, '2026-01-05');

let db: TestDatabase;
let businessId: string;
let serviceId: string;

beforeAll(async () => {
  db = await startTestTransaction();

  const b = await systemQueryOne<{ id: string }>(
    `INSERT INTO torim.businesses
       (slug, name, timezone, currency, default_calling_code, slot_granularity_min,
        min_notice_min, max_advance_days, cancellation_window_min)
     VALUES ('public-test', 'Public Test', $1, 'ILS', '972', 60, 0, 365, 120)
     RETURNING id`,
    [TZ],
  );
  businessId = b!.id;

  await runWithTenant(businessId, async () => {
    const s = await query<{ id: string }>(
      `INSERT INTO torim.services (name, duration_min, price_minor)
       VALUES ('Cut', 60, 12000) RETURNING id`,
    );
    serviceId = s[0]!.id;
    await query(
      `INSERT INTO torim.working_hours (weekday, start_min, end_min) VALUES (1, 540, 1020)`,
    );
  });
});

afterAll(async () => {
  await db.rollback();
});

describe('bookPublicly', () => {
  it('creates the customer and the booking, and hands back a manage token', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60),
        customerName: 'Ada Lovelace',
        customerPhone: '050-123-4567',
        now: EARLY,
      }),
    );

    expect(result.booking.status).toBe('confirmed');
    expect(result.manageToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.customerCreated).toBe(true);

    const customers = await runWithTenant(businessId, () =>
      query<{ name: string; phone_e164: string }>(
        'SELECT name, phone_e164 FROM torim.customers WHERE id = $1',
        [result.customerId],
      ),
    );
    expect(customers[0]!.phone_e164).toBe('+972501234567');
  });

  it('recognises a returning customer by phone, however it was typed', async () => {
    const again = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(10 * 60),
        customerName: 'Ada L.',
        customerPhone: '+972 50 123 4567',
        now: EARLY,
      }),
    );
    expect(again.customerCreated).toBe(false);
  });

  /**
   * A public form must not be able to rewrite an existing customer's record. In the
   * predecessor project it could, so a typo — or anyone who knew the number — silently
   * renamed a real customer in the owner's list.
   */
  it('never overwrites the stored name of an existing customer', async () => {
    const rows = await runWithTenant(businessId, () =>
      query<{ name: string }>('SELECT name FROM torim.customers WHERE phone_e164 = $1', [
        '+972501234567',
      ]),
    );
    expect(rows[0]!.name).toBe('Ada Lovelace');
  });

  it('rejects a slot the business does not actually offer', async () => {
    await expect(
      runWithTenant(businessId, () =>
        bookPublicly({
          businessId,
          serviceId,
          startsAt: at(3 * 60), // 03:00, long before opening
          customerName: 'Night Owl',
          customerPhone: '0509999001',
          now: EARLY,
        }),
      ),
    ).rejects.toBeInstanceOf(SlotNotAvailableError);
  });

  it('rejects a slot off the granularity grid', async () => {
    await expect(
      runWithTenant(businessId, () =>
        bookPublicly({
          businessId,
          serviceId,
          startsAt: at(11 * 60 + 17),
          customerName: 'Odd Timing',
          customerPhone: '0509999002',
          now: EARLY,
        }),
      ),
    ).rejects.toBeInstanceOf(SlotNotAvailableError);
  });

  it('rejects a slot inside the minimum-notice window', async () => {
    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET min_notice_min = 180 WHERE id = $1', [businessId]),
    );

    await expect(
      runWithTenant(businessId, () =>
        bookPublicly({
          businessId,
          serviceId,
          startsAt: at(13 * 60),
          customerName: 'Too Soon',
          customerPhone: '0509999003',
          now: at(12 * 60), // only an hour ahead
        }),
      ),
    ).rejects.toBeInstanceOf(SlotNotAvailableError);

    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET min_notice_min = 0 WHERE id = $1', [businessId]),
    );
  });

  /**
   * Two different refusals, and the distinction matters.
   *
   * A slot that was already taken when the customer asked never appears in generated
   * availability, so it is refused as SlotNotAvailableError before the write is even
   * attempted. BookingConflictError is reserved for the genuine race — someone taking
   * the slot in the moment between the availability check and the insert — which the
   * advisory lock catches and booking-race.test.ts proves.
   */
  it('refuses a slot that has already been taken', async () => {
    await expect(
      runWithTenant(businessId, () =>
        bookPublicly({
          businessId,
          serviceId,
          startsAt: at(9 * 60),
          customerName: 'Latecomer',
          customerPhone: '0509999004',
          now: EARLY,
        }),
      ),
    ).rejects.toBeInstanceOf(SlotNotAvailableError);
  });

  it('refuses a blocked customer without telling them they are blocked', async () => {
    await runWithTenant(businessId, () =>
      query(
        `INSERT INTO torim.customers (name, phone_e164, blocked) VALUES ('Nuisance', $1, true)`,
        ['+972508888888'],
      ),
    );

    const attempt = runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(15 * 60),
        customerName: 'Nuisance',
        customerPhone: '0508888888',
        now: EARLY,
      }),
    );

    await expect(attempt).rejects.toBeInstanceOf(CustomerBlockedError);
    // The message a customer would see must not disclose the block.
    await expect(attempt).rejects.toThrow(/contact the business/i);
  });

  it('marks a new customer pending when the owner screens new customers', async () => {
    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET confirm_new_customers = true WHERE id = $1', [businessId]),
    );

    const stranger = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(16 * 60),
        customerName: 'Brand New',
        customerPhone: '0507777777',
        now: EARLY,
      }),
    );
    expect(stranger.booking.status).toBe('pending');

    // A known customer is not made to wait.
    const known = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(12 * 60),
        customerName: 'Ada',
        customerPhone: '0501234567',
        now: EARLY,
      }),
    );
    expect(known.booking.status).toBe('confirmed');

    await runWithTenant(businessId, () =>
      query('UPDATE torim.businesses SET confirm_new_customers = false WHERE id = $1', [businessId]),
    );
  });

  it('rejects an unusable phone number before touching the database', async () => {
    await expect(
      runWithTenant(businessId, () =>
        bookPublicly({
          businessId,
          serviceId,
          startsAt: at(14 * 60),
          customerName: 'Typo',
          customerPhone: '123',
          now: EARLY,
        }),
      ),
    ).rejects.toThrow(/phone/i);
  });

  it('flags the booking for the owner’s attention', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(13 * 60),
        customerName: 'Attention Please',
        customerPhone: '0506666666',
        now: EARLY,
      }),
    );
    const rows = await runWithTenant(businessId, () =>
      query<{ last_customer_change_at: Date | null; source: string }>(
        'SELECT last_customer_change_at, source FROM torim.bookings WHERE id = $1',
        [result.booking.id],
      ),
    );
    expect(rows[0]!.source).toBe('customer');
    expect(rows[0]!.last_customer_change_at).not.toBeNull();
  });
});

describe('managing a booking by its token', () => {
  let token: string;
  let bookingId: string;

  beforeAll(async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-06-22'),
        customerName: 'Token Holder',
        customerPhone: '0505555555',
        now: EARLY,
      }),
    );
    token = result.manageToken;
    bookingId = result.booking.id;
  });

  it('finds the booking with no session and no tenant context', async () => {
    const found = await findBookingByManageToken(token);
    expect(found?.booking.id).toBe(bookingId);
    expect(found?.business.id).toBe(businessId);
    expect(found?.service.name).toBe('Cut');
    expect(found?.customer.name).toBe('Token Holder');
  });

  it('returns null for a token that does not exist, disclosing nothing', async () => {
    expect(await findBookingByManageToken('0'.repeat(64))).toBeNull();
    expect(await findBookingByManageToken('not-a-token')).toBeNull();
  });

  it('cancels via the token', async () => {
    const cancelled = await cancelByManageToken({
      token,
      now: at(9 * 60, '2026-06-20'),
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledBy).toBe('customer');
  });

  it('refuses to cancel inside the business’s notice window', async () => {
    const fresh = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(11 * 60, '2026-06-29'),
        customerName: 'Late Canceller',
        customerPhone: '0504444444',
        now: EARLY,
      }),
    );

    await expect(
      cancelByManageToken({
        token: fresh.manageToken,
        now: at(10 * 60 + 30, '2026-06-29'), // 30 minutes ahead, window is 120
      }),
    ).rejects.toThrow(/too late/i);
  });

  it('reschedules via the token, and the booking does not block its own move', async () => {
    const fresh = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-07-06'),
        customerName: 'Mover',
        customerPhone: '0503333333',
        now: EARLY,
      }),
    );

    const moved = await rescheduleByManageToken({
      token: fresh.manageToken,
      startsAt: at(10 * 60, '2026-07-06'),
      now: EARLY,
    });
    expect(moved.startsAt.getTime()).toBe(at(10 * 60, '2026-07-06').getTime());
  });

  it('refuses to reschedule onto a slot that is not offered', async () => {
    const fresh = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-07-13'),
        customerName: 'Wanderer',
        customerPhone: '0502222222',
        now: EARLY,
      }),
    );

    await expect(
      rescheduleByManageToken({
        token: fresh.manageToken,
        startsAt: at(4 * 60, '2026-07-13'),
        now: EARLY,
      }),
    ).rejects.toBeInstanceOf(SlotNotAvailableError);
  });
});

/**
 * SEQUENCE in an iCal file must increase with every revision, or a calendar client is
 * entitled to ignore an update and leave the old time sitting in someone's diary.
 *
 * A constant 0 fails that outright. Deriving it from the appointment's start time fails
 * subtly and worse: it advances when a booking moves later and goes BACKWARDS when it
 * moves earlier, so "your appointment is an hour earlier" is exactly the update a strict
 * client discards. A revision counter is monotonic by construction.
 */
describe('booking revision', () => {
  it('starts at zero', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-07-20'),
        customerName: 'Revision Zero',
        customerPhone: '0501010101',
        now: EARLY,
      }),
    );
    const found = await findBookingByManageToken(result.manageToken);
    expect(found?.revision).toBe(0);
  });

  it('advances when the booking is moved', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-07-27'),
        customerName: 'Revision Mover',
        customerPhone: '0502020202',
        now: EARLY,
      }),
    );

    await rescheduleByManageToken({
      token: result.manageToken,
      startsAt: at(11 * 60, '2026-07-27'),
      now: EARLY,
    });
    expect((await findBookingByManageToken(result.manageToken))?.revision).toBe(1);

    // Moving EARLIER must still advance it — this is the case a start-time-derived
    // sequence gets wrong.
    await rescheduleByManageToken({
      token: result.manageToken,
      startsAt: at(10 * 60, '2026-07-27'),
      now: EARLY,
    });
    expect((await findBookingByManageToken(result.manageToken))?.revision).toBe(2);
  });

  it('advances when the booking is cancelled', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-08-03'),
        customerName: 'Revision Canceller',
        customerPhone: '0503030303',
        now: EARLY,
      }),
    );
    await cancelByManageToken({ token: result.manageToken, now: at(9 * 60, '2026-08-01') });
    expect((await findBookingByManageToken(result.manageToken))?.revision).toBe(1);
  });
});

/**
 * Optional email.
 *
 * A business only collects one if it turned the setting on, and only because it has a
 * transport that could use it. Most never will — phone is the identity here.
 */
describe('customer email', () => {
  it('stores an address when one is given', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(9 * 60, '2026-08-10'),
        customerName: 'Emailed Customer',
        customerPhone: '0507000001',
        customerEmail: 'someone@example.invalid',
        now: EARLY,
      }),
    );

    const rows = await runWithTenant(businessId, () =>
      query<{ email: string | null }>('SELECT email FROM torim.customers WHERE id = $1', [
        result.customerId,
      ]),
    );
    expect(rows[0]!.email).toBe('someone@example.invalid');
  });

  it('leaves the address null when none is given', async () => {
    const result = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(10 * 60, '2026-08-10'),
        customerName: 'No Email',
        customerPhone: '0507000002',
        now: EARLY,
      }),
    );
    const rows = await runWithTenant(businessId, () =>
      query<{ email: string | null }>('SELECT email FROM torim.customers WHERE id = $1', [
        result.customerId,
      ]),
    );
    expect(rows[0]!.email).toBeNull();
  });

  it('fills in a missing address for a customer who already exists', async () => {
    const first = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(11 * 60, '2026-08-10'),
        customerName: 'Later Emailer',
        customerPhone: '0507000003',
        now: EARLY,
      }),
    );

    await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(12 * 60, '2026-08-10'),
        customerName: 'Later Emailer',
        customerPhone: '0507000003',
        customerEmail: 'later@example.invalid',
        now: EARLY,
      }),
    );

    const rows = await runWithTenant(businessId, () =>
      query<{ email: string | null }>('SELECT email FROM torim.customers WHERE id = $1', [
        first.customerId,
      ]),
    );
    expect(rows[0]!.email).toBe('later@example.invalid');
  });

  /**
   * The same rule as the name, and for a sharper reason: anyone who knows a customer's
   * phone number could otherwise redirect her confirmations to an address of their
   * choosing. Filling a blank is helpful; replacing one is a takeover.
   */
  it('never replaces an address already on file', async () => {
    const first = await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(13 * 60, '2026-08-10'),
        customerName: 'Settled Address',
        customerPhone: '0507000004',
        customerEmail: 'real@example.invalid',
        now: EARLY,
      }),
    );

    await runWithTenant(businessId, () =>
      bookPublicly({
        businessId,
        serviceId,
        startsAt: at(14 * 60, '2026-08-10'),
        customerName: 'Settled Address',
        customerPhone: '0507000004',
        customerEmail: 'attacker@example.invalid',
        now: EARLY,
      }),
    );

    const rows = await runWithTenant(businessId, () =>
      query<{ email: string | null }>('SELECT email FROM torim.customers WHERE id = $1', [
        first.customerId,
      ]),
    );
    expect(rows[0]!.email).toBe('real@example.invalid');
  });

  it('rejects something that is not an address rather than storing it', async () => {
    await expect(
      runWithTenant(businessId, () =>
        bookPublicly({
          businessId,
          serviceId,
          startsAt: at(15 * 60, '2026-08-10'),
          customerName: 'Bad Address',
          customerPhone: '0507000005',
          customerEmail: 'not-an-email',
          now: EARLY,
        }),
      ),
    ).rejects.toThrow(/email/i);
  });
});
