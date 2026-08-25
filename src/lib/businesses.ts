/**
 * Business lookup.
 *
 * `torim.businesses` is deliberately outside RLS: a customer opening a public booking
 * link has no session and no tenant context, so the slug has to be resolvable before
 * one exists. That is why these use the systemQuery path — reach for it knowingly.
 */
import { systemQueryOne } from './db';

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
};

const COLUMNS = `id, slug, name, name_he, timezone, default_locale, currency, default_calling_code,
                 slot_granularity_min, min_notice_min, max_advance_days,
                 cancellation_window_min, confirm_new_customers, owner_whatsapp_phone,
                 ask_customer_email, reminder_lead_min`;

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
