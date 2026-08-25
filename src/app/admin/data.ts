/**
 * The admin app's data layer — everything the owner's screens read and write that
 * `src/lib` does not already own.
 *
 * Two deliberate properties:
 *
 *  1. **Every write reports whether it hit anything.** Each UPDATE/DELETE returns its
 *     ids, so a write aimed at another business's row comes back `false` instead of
 *     appearing to succeed. RLS is what makes it miss; this is what makes the miss
 *     visible, and it is what the tenant-scope test asserts against.
 *
 *  2. **No caller passes a business id.** `torim.businesses` is deliberately outside
 *     RLS (a public booking page has to resolve a slug before a tenant exists), so a
 *     settings UPDATE is the one write in this file with no policy underneath it. It
 *     therefore takes its target from `requireBusinessId()` — the id the auth guard
 *     already proved — rather than from an argument. There is no id to get wrong.
 *
 * Server-side only: `query()` throws without a tenant context, which is the intended
 * failure mode if any of this is ever reached from somewhere it should not be.
 */
import { query, systemQuery, withTransaction } from '@/lib/db';
import type { ServiceSummary } from '@/lib/availability';
import type { Closure, DateOverride, WorkingHour } from '@/lib/slots';
import { requireBusinessId } from '@/lib/tenant';
import type { DateKey, Minutes } from '@/lib/time';

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type AdminService = ServiceSummary & { sortOrder: number };

export type ServiceInput = {
  name: string;
  nameHe: string | null;
  description: string | null;
  durationMin: number;
  priceMinor: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  colour: string;
  active: boolean;
};

type ServiceRow = {
  id: string;
  name: string;
  name_he: string | null;
  description: string | null;
  duration_min: number;
  price_minor: number;
  buffer_before_min: number;
  buffer_after_min: number;
  colour: string;
  sort_order: number;
  active: boolean;
};

const SERVICE_COLUMNS = `id, name, name_he, description, duration_min, price_minor,
                         buffer_before_min, buffer_after_min, colour, sort_order, active`;

function toAdminService(row: ServiceRow): AdminService {
  return {
    id: row.id,
    name: row.name,
    nameHe: row.name_he,
    description: row.description,
    durationMin: row.duration_min,
    priceMinor: row.price_minor,
    bufferBeforeMin: row.buffer_before_min,
    bufferAfterMin: row.buffer_after_min,
    colour: row.colour,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

/** Retired services included — this is the catalogue, not the menu. */
export async function listAdminServices(): Promise<AdminService[]> {
  const rows = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM torim.services ORDER BY sort_order, name`,
  );
  return rows.map(toAdminService);
}

export async function getAdminService(id: string): Promise<AdminService | null> {
  const rows = await query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM torim.services WHERE id = $1`,
    [id],
  );
  return rows[0] ? toAdminService(rows[0]) : null;
}

/** New services land last, so adding one never reshuffles the order she arranged. */
export async function createService(input: ServiceInput): Promise<AdminService> {
  const rows = await query<ServiceRow>(
    `INSERT INTO torim.services
       (name, name_he, description, duration_min, price_minor,
        buffer_before_min, buffer_after_min, colour, active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             COALESCE((SELECT max(sort_order) + 1 FROM torim.services), 0))
     RETURNING ${SERVICE_COLUMNS}`,
    [
      input.name,
      input.nameHe,
      input.description,
      input.durationMin,
      input.priceMinor,
      input.bufferBeforeMin,
      input.bufferAfterMin,
      input.colour,
      input.active,
    ],
  );
  const created = rows[0];
  if (!created) throw new Error('Service insert returned no row.');
  return toAdminService(created);
}

/**
 * Editing the catalogue never rewrites history: `torim.bookings` snapshots its own
 * price and buffers at creation, so nothing here reaches an existing appointment.
 */
export async function updateService(id: string, input: ServiceInput): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.services
        SET name = $2, name_he = $3, description = $4, duration_min = $5, price_minor = $6,
            buffer_before_min = $7, buffer_after_min = $8, colour = $9, active = $10,
            updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [
      id,
      input.name,
      input.nameHe,
      input.description,
      input.durationMin,
      input.priceMinor,
      input.bufferBeforeMin,
      input.bufferAfterMin,
      input.colour,
      input.active,
    ],
  );
  return rows.length > 0;
}

/** Retiring: the service stops being bookable and every existing booking is untouched. */
export async function setServiceActive(id: string, active: boolean): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.services SET active = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [id, active],
  );
  return rows.length > 0;
}

/**
 * Hard delete. Fails with a foreign-key violation when the service is on any booking —
 * `ON DELETE RESTRICT` in the schema — which the action turns into "retire it instead".
 */
export async function deleteService(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM torim.services WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export async function countServiceBookings(serviceId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*) AS count FROM torim.bookings WHERE service_id = $1`,
    [serviceId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Move one service one place up (-1) or down (+1).
 *
 * The whole list is renumbered inside one transaction rather than swapping two rows:
 * seeded and hand-edited data can share a `sort_order`, and a swap between two equal
 * values is a no-op the owner experiences as a dead button.
 */
export async function moveService(id: string, direction: -1 | 1): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM torim.services ORDER BY sort_order, name`,
    );
    const ids = rows.map((row) => row.id);
    const from = ids.indexOf(id);
    if (from === -1) return false;

    const to = from + direction;
    if (to < 0 || to >= ids.length) return false;

    ids.splice(to, 0, ...ids.splice(from, 1));

    await client.query(
      `UPDATE torim.services AS s
          SET sort_order = ordering.position, updated_at = now()
         FROM unnest($1::uuid[]) WITH ORDINALITY AS ordering(id, position)
        WHERE s.id = ordering.id`,
      [ids],
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// Working hours, closures and one-off overrides
// ---------------------------------------------------------------------------

export type HoursRow = { id: string; weekday: number; startMin: Minutes; endMin: Minutes };
export type ClosureRecord = {
  id: string;
  onDate: DateKey;
  startMin: Minutes | null;
  endMin: Minutes | null;
  kind: string;
  label: string | null;
};
export type OverrideRecord = {
  id: string;
  onDate: DateKey;
  startMin: Minutes;
  endMin: Minutes;
  label: string | null;
};

export async function listWorkingHours(): Promise<HoursRow[]> {
  const rows = await query<{ id: string; weekday: number; start_min: number; end_min: number }>(
    `SELECT id, weekday, start_min, end_min FROM torim.working_hours
      ORDER BY weekday, start_min`,
  );
  return rows.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    startMin: row.start_min,
    endMin: row.end_min,
  }));
}

export async function addWorkingHours(
  weekday: number,
  startMin: Minutes,
  endMin: Minutes,
): Promise<HoursRow> {
  const rows = await query<{ id: string; weekday: number; start_min: number; end_min: number }>(
    `INSERT INTO torim.working_hours (weekday, start_min, end_min)
     VALUES ($1, $2, $3) RETURNING id, weekday, start_min, end_min`,
    [weekday, startMin, endMin],
  );
  const created = rows[0];
  if (!created) throw new Error('Working-hours insert returned no row.');
  return {
    id: created.id,
    weekday: created.weekday,
    startMin: created.start_min,
    endMin: created.end_min,
  };
}

export async function deleteWorkingHours(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM torim.working_hours WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/**
 * `to_char`, not the driver's date parsing: a DATE is a timezone-free day key and has to
 * stay a string, or it re-acquires exactly the timezone slippage the convention avoids.
 */
const DATE_KEY = `to_char(on_date, 'YYYY-MM-DD')`;

export async function listClosures(from: DateKey, to?: DateKey): Promise<ClosureRecord[]> {
  const rows = await query<{
    id: string;
    on_date: string;
    start_min: number | null;
    end_min: number | null;
    kind: string;
    label: string | null;
  }>(
    `SELECT id, ${DATE_KEY} AS on_date, start_min, end_min, kind, label
       FROM torim.closures
      WHERE on_date >= $1::date AND ($2::date IS NULL OR on_date <= $2::date)
      ORDER BY on_date, start_min NULLS FIRST`,
    [from, to ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    onDate: row.on_date,
    startMin: row.start_min,
    endMin: row.end_min,
    kind: row.kind,
    label: row.label,
  }));
}

export async function addClosure(input: {
  onDate: DateKey;
  startMin: Minutes | null;
  endMin: Minutes | null;
  label: string | null;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO torim.closures (on_date, start_min, end_min, label, kind)
     VALUES ($1::date, $2, $3, $4, 'manual') RETURNING id`,
    [input.onDate, input.startMin, input.endMin, input.label],
  );
  const created = rows[0];
  if (!created) throw new Error('Closure insert returned no row.');
  return created.id;
}

export async function deleteClosure(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM torim.closures WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export async function listDateOverrides(from: DateKey, to?: DateKey): Promise<OverrideRecord[]> {
  const rows = await query<{
    id: string;
    on_date: string;
    start_min: number;
    end_min: number;
    label: string | null;
  }>(
    `SELECT id, ${DATE_KEY} AS on_date, start_min, end_min, label
       FROM torim.date_overrides
      WHERE on_date >= $1::date AND ($2::date IS NULL OR on_date <= $2::date)
      ORDER BY on_date, start_min`,
    [from, to ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    onDate: row.on_date,
    startMin: row.start_min,
    endMin: row.end_min,
    label: row.label,
  }));
}

export async function addDateOverride(input: {
  onDate: DateKey;
  startMin: Minutes;
  endMin: Minutes;
  label: string | null;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO torim.date_overrides (on_date, start_min, end_min, label)
     VALUES ($1::date, $2, $3, $4) RETURNING id`,
    [input.onDate, input.startMin, input.endMin, input.label],
  );
  const created = rows[0];
  if (!created) throw new Error('Date-override insert returned no row.');
  return created.id;
}

export async function deleteDateOverride(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM torim.date_overrides WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export type ScheduleRules = {
  workingHours: WorkingHour[];
  closures: Closure[];
  dateOverrides: DateOverride[];
};

/** Everything needed to decide whether a given date/time is inside opening hours. */
export async function loadScheduleRules(from: DateKey, to: DateKey): Promise<ScheduleRules> {
  const [hours, closures, overrides] = await Promise.all([
    listWorkingHours(),
    listClosures(from, to),
    listDateOverrides(from, to),
  ]);

  return {
    workingHours: hours.map((row) => ({
      weekday: row.weekday,
      startMin: row.startMin,
      endMin: row.endMin,
    })),
    closures: closures.map((row) => ({
      onDate: row.onDate,
      startMin: row.startMin,
      endMin: row.endMin,
    })),
    dateOverrides: overrides.map((row) => ({
      onDate: row.onDate,
      startMin: row.startMin,
      endMin: row.endMin,
    })),
  };
}

// ---------------------------------------------------------------------------
// Bookings — the bits the shared booking engine does not cover
// ---------------------------------------------------------------------------

/**
 * The owner's own note on an appointment. Not `last_customer_change_at`: she is not a
 * customer, and flagging her own edit as something she has not seen is nonsense.
 */
export async function setBookingNote(id: string, note: string | null): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.bookings SET note = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [id, note],
  );
  return rows.length > 0;
}

/** Approve a booking that landed as 'pending' because `confirm_new_customers` is on. */
export async function confirmBooking(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.bookings SET status = 'confirmed', updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export type CustomerVisit = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: 'pending' | 'confirmed' | 'cancelled' | 'no_show';
  priceMinor: number;
  serviceName: string;
  serviceColour: string;
  note: string | null;
};

export async function listCustomerVisits(customerId: string, limit = 100): Promise<CustomerVisit[]> {
  const rows = await query<{
    id: string;
    starts_at: Date;
    ends_at: Date;
    status: CustomerVisit['status'];
    price_minor: number;
    note: string | null;
    service_name: string;
    service_colour: string;
  }>(
    `SELECT b.id, b.starts_at, b.ends_at, b.status, b.price_minor, b.note,
            s.name AS service_name, s.colour AS service_colour
       FROM torim.bookings b
       JOIN torim.services s ON s.id = b.service_id
      WHERE b.customer_id = $1
      ORDER BY b.starts_at DESC
      LIMIT $2`,
    [customerId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    priceMinor: row.price_minor,
    serviceName: row.service_name,
    serviceColour: row.service_colour,
    note: row.note,
  }));
}

// ---------------------------------------------------------------------------
// Business settings — the one write with no RLS policy under it
// ---------------------------------------------------------------------------

export type BusinessSettingsInput = {
  name: string;
  nameHe: string | null;
  slug: string;
  timezone: string;
  currency: string;
  defaultLocale: 'en' | 'he';
  defaultCallingCode: string | null;
  ownerWhatsappPhone: string | null;
  slotGranularityMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  cancellationWindowMin: number;
  confirmNewCustomers: boolean;
  /** NULL means no reminders at all — not the same as 0, "at the appointment time". */
  reminderLeadMin: number | null;
  askCustomerEmail: boolean;
};

/**
 * The two columns the booking form and the notification queue both care about.
 *
 * Read here rather than through `@/lib/businesses`, whose `PublicBusiness` is the shape
 * an unauthenticated booking page is allowed to resolve from a slug. These are settings
 * the owner's own screen reads about her own business, so they take their target from
 * the tenant the auth guard already proved — same rule as every other write in this file.
 */
export type MessagingSettings = {
  askCustomerEmail: boolean;
  reminderLeadMin: number | null;
};

export async function getMessagingSettings(): Promise<MessagingSettings> {
  const businessId = requireBusinessId();

  const rows = await systemQuery<{
    ask_customer_email: boolean;
    reminder_lead_min: number | null;
  }>(
    `SELECT ask_customer_email, reminder_lead_min FROM torim.businesses WHERE id = $1`,
    [businessId],
  );

  const row = rows[0];
  // Defaults that match the schema's, so a business row that vanished mid-request
  // renders a form that asks for nothing and sends nothing rather than one that lies.
  return {
    askCustomerEmail: row?.ask_customer_email ?? false,
    reminderLeadMin: row?.reminder_lead_min ?? null,
  };
}

/**
 * Update the signed-in owner's business.
 *
 * Takes NO business id. `torim.businesses` has no RLS policy, so an id parameter here
 * would be a cross-tenant write waiting for one wrong argument; instead the target is
 * read from the tenant context the auth guard already established, and there is nothing
 * a caller could pass that would aim this somewhere else.
 */
export async function updateBusinessSettings(input: BusinessSettingsInput): Promise<void> {
  const businessId = requireBusinessId();

  await systemQuery(
    `UPDATE torim.businesses
        SET name = $2, name_he = $3, slug = $4, timezone = $5, currency = $6,
            default_locale = $7, default_calling_code = $8, owner_whatsapp_phone = $9,
            slot_granularity_min = $10, min_notice_min = $11, max_advance_days = $12,
            cancellation_window_min = $13, confirm_new_customers = $14,
            reminder_lead_min = $15, ask_customer_email = $16, updated_at = now()
      WHERE id = $1`,
    [
      businessId,
      input.name,
      input.nameHe,
      input.slug,
      input.timezone,
      input.currency,
      input.defaultLocale,
      input.defaultCallingCode,
      input.ownerWhatsappPhone,
      input.slotGranularityMin,
      input.minNoticeMin,
      input.maxAdvanceDays,
      input.cancellationWindowMin,
      input.confirmNewCustomers,
      input.reminderLeadMin,
      input.askCustomerEmail,
    ],
  );
}

/**
 * Finish onboarding: the two columns `create_business_with_owner` does not take.
 * Same rule as above — the id comes from the caller's proven tenant scope.
 */
export async function applyOnboardingExtras(
  businessId: string,
  input: { defaultCallingCode: string | null; defaultLocale: 'en' | 'he' },
): Promise<void> {
  await systemQuery(
    `UPDATE torim.businesses
        SET default_calling_code = $2, default_locale = $3, updated_at = now()
      WHERE id = $1`,
    [businessId, input.defaultCallingCode, input.defaultLocale],
  );
}

/**
 * Another live booking whose occupied interval (buffers included) overlaps this one.
 *
 * Used *after* a deliberate override, so the confirmation can name what she just booked
 * over instead of saying "this overlaps something". `blocks_from`/`blocks_until` are the
 * same columns the booking engine's conflict check uses, so the two cannot disagree.
 */
export async function findOverlappingBooking(bookingId: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT other.id
       FROM torim.bookings AS subject
       JOIN torim.bookings AS other
         ON other.id <> subject.id
        AND other.status IN ('pending', 'confirmed')
        AND other.blocks_from  < subject.blocks_until
        AND other.blocks_until > subject.blocks_from
      WHERE subject.id = $1
      ORDER BY other.starts_at
      LIMIT 1`,
    [bookingId],
  );
  return rows[0]?.id ?? null;
}

/**
 * The signed-in person's own record.
 *
 * `torim.users` sits outside RLS with the rest of the tenancy tables, so this is scoped
 * by the id the session proved — the same id `requireAuth()` re-read the membership for.
 */
export async function getSignedInUser(
  userId: string,
): Promise<{ email: string; name: string | null } | null> {
  const rows = await systemQuery<{ email: string; name: string | null }>(
    `SELECT email, name FROM torim.users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}
