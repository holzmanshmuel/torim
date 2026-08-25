/**
 * Demo data seed.
 *
 * Creates one obviously fictional business ("Lumen Beauty Studio", slug "demo") with
 * enough data — services, working hours, closures, customers, bookings — to make the
 * app usable and demoable end to end.
 *
 * Idempotent: keyed off the business slug. Re-running upserts the business row, then
 * wipes and re-inserts everything that belongs to it, so the demo data (and the "coming
 * week" of bookings) stays fresh no matter when this runs.
 *
 * ⚠ Destructive by design, guarded on purpose. The predecessor project's seed and reset
 * scripts read the same DATABASE_URL as production with no guard at all — this one
 * refuses to run unless the target database name looks like development or test.
 *
 * Respects tenancy: the business row itself is pre-tenant (systemQuery, against the
 * non-RLS torim.businesses table); everything else is tenant-scoped and only reachable
 * inside runWithTenant — the app role cannot see or write those rows without the
 * tenant GUC set, same as the running app.
 *
 * Run with:
 *   npm run db:seed
 */
import { DateTime } from 'luxon';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

import { closePool, query, systemQuery, systemQueryOne } from '../src/lib/db';
import { runWithTenant } from '../src/lib/tenant';

const SLUG = 'demo';
const NAME = 'Lumen Beauty Studio';
const NAME_HE = 'סטודיו לומן';
const TIMEZONE = 'Asia/Jerusalem';
const CURRENCY = 'ILS';
/** Israel. Lets the demo accept a locally-typed number like "050-123-4567". */
const CALLING_CODE = '972';
const OWNER_WHATSAPP = '+16465550109'; // reserved fictional-use number (NANPA 555-01xx block)

// Business weekday convention used throughout the schema: 0=Sunday … 6=Saturday.
const SATURDAY = 6;

type Service = {
  id: string;
  name: string;
  duration_min: number;
  price_minor: number;
  buffer_before_min: number;
  buffer_after_min: number;
};
type Customer = { id: string; name: string };

/**
 * Refuse to run against anything that doesn't look like a throwaway database.
 * Loud, non-zero exit, explained — never a silent no-op and never "just this once".
 */
function assertSafeToSeed(): void {
  if (process.env.ALLOW_DESTRUCTIVE_SEED === '1') {
    console.warn('ALLOW_DESTRUCTIVE_SEED=1 is set — skipping the dev/test database name check.\n');
    return;
  }

  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error(
      'DATABASE_URL is not set. This script deletes and re-creates every row belonging to the\n' +
        '"demo" business before reseeding it — refusing to run without knowing the target database.',
    );
    process.exit(1);
  }

  let dbName: string;
  try {
    dbName = new URL(raw).pathname.replace(/^\//, '');
  } catch {
    console.error(`DATABASE_URL is not a valid connection string.`);
    process.exit(1);
    return;
  }

  if (!/(_dev|_test)$/i.test(dbName)) {
    console.error(
      `Refusing to run: DATABASE_URL points at database "${dbName}", which does not look like a\n` +
        'development or test database (expected a name ending in "_dev" or "_test").\n\n' +
        'This script is DESTRUCTIVE — it deletes and re-inserts every services/working-hours/\n' +
        'closures/customers/bookings row belonging to the "demo" business. Running it against a\n' +
        'real database would destroy real data with no way back.\n\n' +
        'If this really is the right database, set ALLOW_DESTRUCTIVE_SEED=1 to override.',
    );
    process.exit(1);
  }
}

/** The next `count` business days (skipping Saturday), starting tomorrow, at local midnight. */
function nextBusinessDays(count: number, timezone: string): DateTime[] {
  const days: DateTime[] = [];
  let cursor = DateTime.now().setZone(timezone).startOf('day').plus({ days: 1 });
  while (days.length < count) {
    if (cursor.weekday % 7 !== SATURDAY) {
      days.push(cursor);
    }
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

function at(day: DateTime, hour: number, minute: number): Date {
  return day.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

async function main(): Promise<void> {
  assertSafeToSeed();

  try {
    console.log(`Seeding demo business "${NAME}" (slug: ${SLUG})...\n`);

    const business = await systemQueryOne<{ id: string }>(
      // default_calling_code matters more than it looks: without it a visitor typing
      // "050-123-4567" on the demo page is rejected, because a local number cannot be
      // resolved to E.164 without knowing the country. The demo is the shop window.
      //
      // cancellation_window_min is 60 rather than the 24-hour default so the demo's
      // cancel flow actually works. Worth knowing WHY: if a business lets customers book
      // with less notice than its cancellation window, they can create a booking they
      // immediately cannot cancel online. Sensible for a real salon, terrible on a demo
      // where the first free slot is often today.
      //
      // confirm_new_customers is deliberately false here. It is a real feature — the
      // owner screening first-time customers — but on a demo it would greet every
      // visitor's booking with "the business will confirm", which reads as broken
      // rather than as a feature. Flip it to see that flow.
      `INSERT INTO torim.businesses
         (slug, name, name_he, timezone, default_locale, currency, default_calling_code,
          confirm_new_customers, cancellation_window_min, owner_whatsapp_phone)
       VALUES ($1, $2, $3, $4, 'en', $5, $6, false, 60, $7)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         name_he = EXCLUDED.name_he,
         timezone = EXCLUDED.timezone,
         currency = EXCLUDED.currency,
         default_calling_code = EXCLUDED.default_calling_code,
         confirm_new_customers = EXCLUDED.confirm_new_customers,
         cancellation_window_min = EXCLUDED.cancellation_window_min,
         owner_whatsapp_phone = EXCLUDED.owner_whatsapp_phone,
         updated_at = now()
       RETURNING id`,
      [SLUG, NAME, NAME_HE, TIMEZONE, CURRENCY, CALLING_CODE, OWNER_WHATSAPP],
    );
    if (!business) throw new Error('Business upsert returned no row.');
    const businessId = business.id;

    // Optional: make the demo business reachable from /admin.
    //
    // Without this the seed creates a business nobody owns — /b/demo works, but signing
    // in lands on /onboarding and creates a *second*, empty business, which is a
    // confusing first run.
    //
    // This ATTACHES an existing signed-in user; it does not invent one. Users are keyed
    // on their Google subject id, never on email, so a row minted here with a made-up
    // subject would never match a real sign-in — the membership would look correct in
    // the database and do nothing. Sign in once first, then run the seed.
    const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
    if (ownerEmail) {
      const owner = await systemQueryOne<{ id: string }>(
        'SELECT id FROM torim.users WHERE lower(email) = $1',
        [ownerEmail],
      );

      if (owner) {
        await systemQuery(
          `INSERT INTO torim.memberships (user_id, business_id, role) VALUES ($1, $2, 'owner')
           ON CONFLICT (user_id, business_id) DO UPDATE SET role = 'owner'`,
          [owner.id, businessId],
        );
        console.log(`  owner:         ${ownerEmail} — you can now open /admin`);
      } else {
        console.log(
          `  owner:         no account yet for ${ownerEmail}.\n` +
            '                 Sign in at /login once (that creates it), then re-run this seed\n' +
            '                 with the same SEED_OWNER_EMAIL to attach it to the demo business.',
        );
      }
    }

    const counts = await runWithTenant(businessId, async () => {
      // Idempotent-by-wipe: clear this business's own rows before re-inserting, in FK
      // order (bookings first — notifications cascade from them; customers and services
      // are ON DELETE RESTRICT from bookings, so they must go after).
      await query('DELETE FROM torim.bookings');
      await query('DELETE FROM torim.customers');
      await query('DELETE FROM torim.services');
      await query('DELETE FROM torim.working_hours');
      await query('DELETE FROM torim.closures');

      // ---- services: different durations, prices and buffers ----------------------
      const serviceRows: [string, string, string, number, number, number, number, string, number][] = [
        ['Haircut', 'תספורת', 'Wash, cut and style.', 30, 12_000, 0, 10, 'blue', 1],
        ['Color & Style', 'צבע ועיצוב', 'Full color with blow-dry finish.', 90, 35_000, 10, 15, 'purple', 2],
        ['Blow Dry', 'פן', 'Wash and blow-dry only.', 20, 8_000, 0, 5, 'green', 3],
        ['Beard Trim', 'עיצוב זקן', 'Shape and trim.', 15, 6_000, 0, 0, 'amber', 4],
      ];
      const services: Service[] = [];
      for (const [name, name_he, description, duration, price, bufBefore, bufAfter, colour, sort] of serviceRows) {
        const row = await query<Service>(
          `INSERT INTO torim.services
             (name, name_he, description, duration_min, price_minor, buffer_before_min, buffer_after_min, colour, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, name, duration_min, price_minor, buffer_before_min, buffer_after_min`,
          [name, name_he, description, duration, price, bufBefore, bufAfter, colour, sort],
        );
        services.push(row[0]!);
      }
      const serviceByName = new Map(services.map((s) => [s.name, s]));

      // ---- working hours: Sun–Thu full days (two with a lunch break), Fri short, Sat closed
      const HOURS = (h: number, m = 0) => h * 60 + m;
      const workingHours: [number, number, number][] = [
        [0, HOURS(9), HOURS(13)], // Sunday morning
        [0, HOURS(14), HOURS(19)], // Sunday afternoon — break 13:00–14:00
        [1, HOURS(9), HOURS(19)], // Monday
        [2, HOURS(9), HOURS(19)], // Tuesday
        [3, HOURS(9), HOURS(13)], // Wednesday morning
        [3, HOURS(14), HOURS(19)], // Wednesday afternoon — break 13:00–14:00
        [4, HOURS(9), HOURS(19)], // Thursday
        [5, HOURS(9), HOURS(14)], // Friday — short day
        // 6 (Saturday): closed, no row.
      ];
      for (const [weekday, start, end] of workingHours) {
        await query('INSERT INTO torim.working_hours (weekday, start_min, end_min) VALUES ($1,$2,$3)', [
          weekday,
          start,
          end,
        ]);
      }

      // ---- closures ----------------------------------------------------------------
      await query('INSERT INTO torim.closures (on_date, kind, label) VALUES ($1,$2,$3)', [
        DateTime.now().setZone(TIMEZONE).plus({ days: 10 }).toISODate(),
        'manual',
        'Staff Training Day',
      ]);
      await query('INSERT INTO torim.closures (on_date, kind, label) VALUES ($1,$2,$3)', [
        DateTime.now().setZone(TIMEZONE).plus({ days: 20 }).toISODate(),
        'holiday',
        "Founders' Day (observed)",
      ]);

      // ---- customers: fictional people, fake E.164 numbers (reserved 555-01xx block)
      const customerRows: [string, string, string | null][] = [
        ['Jordan Rivera', '+12125550142', 'jordan.rivera@example.com'],
        ['Casey Morgan', '+13105550187', 'casey.morgan@example.com'],
        ['Sam Okafor', '+14155550119', null],
      ];
      const customers: Customer[] = [];
      for (const [name, phone, email] of customerRows) {
        const row = await query<Customer>(
          'INSERT INTO torim.customers (name, phone_e164, email) VALUES ($1,$2,$3) RETURNING id, name',
          [name, phone, email],
        );
        customers.push(row[0]!);
      }
      const customerByName = new Map(customers.map((c) => [c.name, c]));

      // ---- bookings: a handful across the coming week, mixed statuses and sources --
      const days = nextBusinessDays(5, TIMEZONE);
      const bookingSpecs: {
        day: DateTime;
        hour: number;
        minute: number;
        service: string;
        customer: string;
        status: 'pending' | 'confirmed' | 'cancelled';
        source: 'customer' | 'admin';
        note?: string;
        cancelled?: boolean;
      }[] = [
        { day: days[0]!, hour: 9, minute: 15, service: 'Haircut', customer: 'Jordan Rivera', status: 'confirmed', source: 'customer' },
        { day: days[0]!, hour: 10, minute: 0, service: 'Beard Trim', customer: 'Sam Okafor', status: 'confirmed', source: 'admin' },
        { day: days[1]!, hour: 9, minute: 0, service: 'Color & Style', customer: 'Casey Morgan', status: 'confirmed', source: 'customer', note: 'Requested extra time for photos after.' },
        { day: days[2]!, hour: 11, minute: 0, service: 'Blow Dry', customer: 'Sam Okafor', status: 'pending', source: 'customer' },
        { day: days[3]!, hour: 9, minute: 30, service: 'Beard Trim', customer: 'Jordan Rivera', status: 'cancelled', source: 'customer', cancelled: true },
        { day: days[4]!, hour: 10, minute: 0, service: 'Haircut', customer: 'Casey Morgan', status: 'confirmed', source: 'admin' },
      ];

      let bookingCount = 0;
      for (const spec of bookingSpecs) {
        const service = serviceByName.get(spec.service);
        const customer = customerByName.get(spec.customer);
        if (!service || !customer) throw new Error(`Missing lookup for booking spec ${JSON.stringify(spec)}`);

        const startsAt = at(spec.day, spec.hour, spec.minute);
        const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000);
        const cancelledAt = spec.cancelled ? DateTime.now().minus({ hours: 3 }).toJSDate() : null;
        const cancelledBy = spec.cancelled ? 'customer' : null;

        await query(
          `INSERT INTO torim.bookings
             (customer_id, service_id, starts_at, ends_at, buffer_before_min, buffer_after_min,
              status, price_minor, note, source, cancelled_at, cancelled_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            customer.id,
            service.id,
            startsAt,
            endsAt,
            service.buffer_before_min,
            service.buffer_after_min,
            spec.status,
            service.price_minor,
            spec.note ?? null,
            spec.source,
            cancelledAt,
            cancelledBy,
          ],
        );
        bookingCount += 1;
      }

      return {
        services: services.length,
        workingHours: workingHours.length,
        closures: 2,
        customers: customers.length,
        bookings: bookingCount,
      };
    });

    console.log('Done. Created:');
    console.log(`  business:      ${NAME} (slug: ${SLUG})`);
    console.log(`  services:      ${counts.services}`);
    console.log(`  working hours: ${counts.workingHours} rows (incl. one short day, one day with a break)`);
    console.log(`  closures:      ${counts.closures}`);
    console.log(`  customers:     ${counts.customers}`);
    console.log(`  bookings:      ${counts.bookings} across the coming week`);
    console.log(`\nPublic booking slug: ${SLUG}`);
  } finally {
    await closePool();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
