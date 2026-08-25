/**
 * The owner's view of her own schedule.
 *
 * Two things here are deliberate rather than incidental:
 *
 * 1. A day is bounded by the business's LOCAL midnights and nothing else — not by
 *    opening hours. The predecessor project's day view was hardcoded to the public
 *    booking window, so an appointment the owner had entered herself for 07:30 simply
 *    did not appear. She had created it and could not see it.
 *
 * 2. "A customer changed something" is derived from timestamps, not a boolean flag. A
 *    boolean is cleared by the first glance and stays cleared through everything that
 *    happens afterwards; comparing owner_seen_at against last_customer_change_at means
 *    a later change reopens it by itself.
 */
import { query } from './db';
import { addDays, localToInstant, type DateKey } from './time';
import { findBusinessById } from './businesses';

export type BookingListItem = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: 'pending' | 'confirmed' | 'cancelled' | 'no_show';
  priceMinor: number;
  finalPriceMinor: number | null;
  note: string | null;
  source: 'customer' | 'admin';
  manageToken: string;
  /** True when the customer has changed this since the owner last looked. */
  needsAttention: boolean;
  customer: { id: string; name: string; phone: string; blocked: boolean };
  service: { id: string; name: string; colour: string; durationMin: number };
};

type Row = {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: BookingListItem['status'];
  price_minor: number;
  final_price_minor: number | null;
  note: string | null;
  source: BookingListItem['source'];
  manage_token: string;
  needs_attention: boolean;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_blocked: boolean;
  service_id: string;
  service_name: string;
  service_colour: string;
  service_duration_min: number;
};

/** The single definition of "the customer has changed this since the owner looked". */
const NEEDS_ATTENTION = `(b.last_customer_change_at IS NOT NULL
   AND (b.owner_seen_at IS NULL OR b.owner_seen_at < b.last_customer_change_at))`;

const SELECT_LIST = `
  SELECT b.id, b.starts_at, b.ends_at, b.status, b.price_minor, b.final_price_minor,
         b.note, b.source, b.manage_token,
         ${NEEDS_ATTENTION} AS needs_attention,
         c.id AS customer_id, c.name AS customer_name,
         c.phone_e164 AS customer_phone, c.blocked AS customer_blocked,
         s.id AS service_id, s.name AS service_name,
         s.colour AS service_colour, s.duration_min AS service_duration_min
    FROM torim.bookings b
    JOIN torim.customers c ON c.id = b.customer_id
    JOIN torim.services  s ON s.id = b.service_id`;

function toItem(row: Row): BookingListItem {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    priceMinor: row.price_minor,
    finalPriceMinor: row.final_price_minor,
    note: row.note,
    source: row.source,
    manageToken: row.manage_token,
    needsAttention: row.needs_attention,
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      phone: row.customer_phone,
      blocked: row.customer_blocked,
    },
    service: {
      id: row.service_id,
      name: row.service_name,
      colour: row.service_colour,
      durationMin: row.service_duration_min,
    },
  };
}

/**
 * Every booking that starts within [from 00:00, to+1 00:00) in business-local time.
 * Cancelled and no-show bookings are included: the owner needs to see what happened to
 * her day, not a tidied version of it.
 */
export async function listBookingsForRange(args: {
  businessId: string;
  from: DateKey;
  to: DateKey;
}): Promise<BookingListItem[]> {
  const business = await findBusinessById(args.businessId);
  if (!business) throw new Error(`Unknown business: ${args.businessId}`);

  const start = localToInstant(args.from, 0, business.timezone);
  const end = localToInstant(addDays(args.to, 1), 0, business.timezone);

  const rows = await query<Row>(
    `${SELECT_LIST} WHERE b.starts_at >= $1 AND b.starts_at < $2 ORDER BY b.starts_at`,
    [start, end],
  );
  return rows.map(toItem);
}

export async function listBookingsForDay(args: {
  businessId: string;
  date: DateKey;
}): Promise<BookingListItem[]> {
  return listBookingsForRange({ businessId: args.businessId, from: args.date, to: args.date });
}

export async function getBookingForAdmin(id: string): Promise<BookingListItem | null> {
  const rows = await query<Row>(`${SELECT_LIST} WHERE b.id = $1`, [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

/** Everything the customer has changed that the owner has not yet looked at. */
export async function listUnseenChanges(): Promise<BookingListItem[]> {
  const rows = await query<Row>(
    `${SELECT_LIST} WHERE ${NEEDS_ATTENTION} ORDER BY b.last_customer_change_at DESC`,
  );
  return rows.map(toItem);
}

export async function countUnseenChanges(): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*) AS count FROM torim.bookings b WHERE ${NEEDS_ATTENTION}`,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markBookingSeen(bookingId: string): Promise<void> {
  await query('UPDATE torim.bookings SET owner_seen_at = now() WHERE id = $1', [bookingId]);
}

/** Returns how many were cleared, so the UI can confirm what just happened. */
export async function markAllSeen(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE torim.bookings b SET owner_seen_at = now()
      WHERE ${NEEDS_ATTENTION} RETURNING b.id`,
  );
  return rows.length;
}
