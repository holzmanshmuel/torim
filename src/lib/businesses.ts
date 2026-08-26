/**
 * Business lookup.
 *
 * `torim.businesses` is deliberately outside RLS: a customer opening a public booking
 * link has no session and no tenant context, so the slug has to be resolvable before
 * one exists. That is why these use the systemQuery path — reach for it knowingly.
 */
import { systemQuery, systemQueryOne } from './db';

export type PublicBusiness = {
  id: string;
  slug: string;
  name: string;
  nameHe: string | null;
  timezone: string;
  defaultLocale: 'en' | 'he';
  currency: string;
  /** Country code without the plus, e.g. '972'. Null means customers must type a full international number. */
  defaultCallingCode: string | null;
  slotGranularityMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  cancellationWindowMin: number;
  confirmNewCustomers: boolean;
  ownerWhatsappPhone: string | null;
  /** Whether the booking form asks for an optional email. Off unless a business turns it on. */
  askCustomerEmail: boolean;
  /** Minutes before an appointment a reminder is due. Null means this business wants none. */
  reminderLeadMin: number | null;
  /** How many live future bookings one customer may hold at once. */
  maxFutureBookingsPerCustomer: number;
};

type Row = {
  id: string;
  slug: string;
  name: string;
  name_he: string | null;
  timezone: string;
  default_locale: 'en' | 'he';
  currency: string;
  default_calling_code: string | null;
  slot_granularity_min: number;
  min_notice_min: number;
  max_advance_days: number;
  cancellation_window_min: number;
  confirm_new_customers: boolean;
  owner_whatsapp_phone: string | null;
  ask_customer_email: boolean;
  reminder_lead_min: number | null;
  max_future_bookings_per_customer: number;
};

const COLUMNS = `id, slug, name, name_he, timezone, default_locale, currency, default_calling_code,
                 slot_granularity_min, min_notice_min, max_advance_days,
                 cancellation_window_min, confirm_new_customers, owner_whatsapp_phone,
                 ask_customer_email, reminder_lead_min, max_future_bookings_per_customer`;

function toBusiness(row: Row): PublicBusiness {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameHe: row.name_he,
    timezone: row.timezone,
    defaultLocale: row.default_locale,
    currency: row.currency,
    defaultCallingCode: row.default_calling_code,
    slotGranularityMin: row.slot_granularity_min,
    minNoticeMin: row.min_notice_min,
    maxAdvanceDays: row.max_advance_days,
    cancellationWindowMin: row.cancellation_window_min,
    confirmNewCustomers: row.confirm_new_customers,
    ownerWhatsappPhone: row.owner_whatsapp_phone,
    askCustomerEmail: row.ask_customer_email,
    reminderLeadMin: row.reminder_lead_min,
    maxFutureBookingsPerCustomer: row.max_future_bookings_per_customer,
  };
}

/** Null rather than a throw: an unknown slug is a 404 page, not an error page. */
export async function findBusinessBySlug(slug: string): Promise<PublicBusiness | null> {
  const row = await systemQueryOne<Row>(
    `SELECT ${COLUMNS} FROM torim.businesses WHERE slug = $1`,
    [slug],
  );
  return row ? toBusiness(row) : null;
}

export async function findBusinessById(id: string): Promise<PublicBusiness | null> {
  const row = await systemQueryOne<Row>(`SELECT ${COLUMNS} FROM torim.businesses WHERE id = $1`, [
    id,
  ]);
  return row ? toBusiness(row) : null;
}
/**
 * What shape of instance is this?
 *
 * Torim is multi-tenant, but most deployments are one salon on one box. `/` cannot
 * answer "what should I show?" without knowing which of the three cases it is in, and
 * the three want genuinely different pages: an empty instance wants its owner to sign
 * in and create a business, a single-business instance wants to *be* that booking page,
 * and a shared instance must not hint at who else is on it.
 *
 * `LIMIT 2` is the whole trick: two rows is all it takes to tell none from one from
 * many, so this never scans a tenant list however large the instance grows — and it
 * never has one in memory to leak.
 *
 * Uses the systemQuery path knowingly: `torim.businesses` is one of the three tables
 * deliberately outside RLS (see the header of scripts/sql/001_tenancy.sql), precisely
 * because it has to be readable before any tenant context exists. Nothing here is
 * routing around a policy.
 */
export type InstanceShape =
  | { kind: 'empty' }
  | { kind: 'single'; slug: string }
  | { kind: 'multi' };

export async function describeInstance(): Promise<InstanceShape> {
  const rows = await systemQuery<{ slug: string }>(
    'SELECT slug FROM torim.businesses ORDER BY created_at, slug LIMIT 2',
  );

  if (rows.length === 0) return { kind: 'empty' };
  if (rows.length === 1) return { kind: 'single', slug: rows[0].slug };
  return { kind: 'multi' };
}
