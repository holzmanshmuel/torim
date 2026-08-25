/**
 * Turning a queued row into something a transport can send.
 *
 * Reads the booking, service, customer and business as they are *now*, not as they were
 * when the notification was queued: a reminder queued a week ago should describe the
 * appointment's current time, not the one it had when it was booked.
 */
import { query } from '../db';
import { DateTime } from 'luxon';
import { renderTemplate } from './templates';
import type { QueuedNotification } from './queue';
import type { OutboundMessage } from './types';

type Row = {
  starts_at: Date;
  manage_token: string;
  service_name: string;
  service_name_he: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  business_name: string;
  business_name_he: string | null;
  timezone: string;
};

/** Public origin for management links. Falls back to a relative path rather than guessing a host. */
function manageUrl(token: string): string {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/manage/${token}` : `/manage/${token}`;
}

/** Null when the booking has gone — a queued notification can outlive its subject. */
export async function renderMessage(
  notification: QueuedNotification,
): Promise<OutboundMessage | null> {
  if (!notification.bookingId) return null;

  const rows = await query<Row>(
    `SELECT b.starts_at, b.manage_token,
            s.name AS service_name, s.name_he AS service_name_he,
            c.name AS customer_name, c.phone_e164 AS customer_phone, c.email AS customer_email,
            biz.name AS business_name, biz.name_he AS business_name_he, biz.timezone
       FROM torim.bookings b
       JOIN torim.services  s   ON s.id = b.service_id
       JOIN torim.customers c   ON c.id = b.customer_id
       JOIN torim.businesses biz ON biz.id = b.business_id
      WHERE b.id = $1`,
    [notification.bookingId],
  );
  const row = rows[0];
  if (!row) return null;

  const locale = notification.locale;

  // Hebrew names are optional per business and per service; fall back rather than
  // showing an empty string where a name should be.
  const businessName = (locale === 'he' && row.business_name_he) || row.business_name;
  const serviceName = (locale === 'he' && row.service_name_he) || row.service_name;

  const when = DateTime.fromJSDate(row.starts_at, { zone: row.timezone })
    .setLocale(locale === 'he' ? 'he-IL' : 'en-GB')
    .toFormat("cccc d LLLL, HH:mm");

  const url = manageUrl(row.manage_token);

  const { subject, body } = renderTemplate(locale, notification.kind, {
    businessName,
    serviceName,
    customerName: row.customer_name,
    when,
    manageUrl: url,
  });

  return {
    id: notification.id,
    businessId: notification.businessId,
    kind: notification.kind,
    channel: notification.channel,
    locale,
    to: {
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email,
    },
    subject,
    body,
    data: {
      businessName,
      serviceName,
      customerName: row.customer_name,
      startsAt: row.starts_at.toISOString(),
      timezone: row.timezone,
      manageUrl: url,
      kind: notification.kind,
    },
  };
}
