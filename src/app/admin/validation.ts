/**
 * Field-level validation for everything the owner types.
 *
 * The rule this file exists for: **a time range is validated as a range, never as two
 * independent fields.** The predecessor shipped two separate time pickers with no
 * cross-check and persisted a closure whose end was before its start. It blocked zero
 * minutes, so customers booked straight through hours the owner believed were shut, and
 * nothing errored anywhere — not in the form, not in the database, not in the logs.
 *
 * There are three layers now and all three are load-bearing:
 *   1. `parseTimeRange` here, called by the client before anything is sent.
 *   2. The same function called again inside the Server Action — a Server Function is
 *      reachable by direct POST, so client-side validation proves nothing.
 *   3. The `CHECK (end_min > start_min)` constraints in the schema, whose violations
 *      `dbErrorCode` maps back to the same friendly codes, so the last line of defence
 *      surfaces as a field message instead of a 500.
 *
 * Every function is pure: no database, no request, no clock it did not receive.
 */
import type { Minutes } from '@/lib/time';

export type Valid<T> = { ok: true; value: T };
export type Invalid = { ok: false; field: string; code: string };
export type Validated<T> = Valid<T> | Invalid;

export function valid<T>(value: T): Valid<T> {
  return { ok: true, value };
}

export function invalid(field: string, code: string): Invalid {
  return { ok: false, field, code };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const HHMM = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/**
 * "09:30" to 570. `allowEndOfDay` additionally accepts "24:00" (1440), which is a legal
 * `end_min` in the schema and the only way to express "open until midnight" — an
 * `<input type="time">` cannot produce it, so the UI offers it as its own choice.
 */
export function parseHhMm(value: string, allowEndOfDay = false): Minutes | null {
  const match = HHMM.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (minutes > 59) return null;
  const total = hours * 60 + minutes;
  if (allowEndOfDay && total === 1440) return 1440;
  if (hours > 23) return null;
  return total;
}

/** YYYY-MM-DD, and a real calendar day — "2026-02-30" is rejected. */
export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function isTimezone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Matches the CHECK on torim.businesses.slug exactly — the same rule, not a near miss. */
export const SLUG_SHAPE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const CURRENCY_SHAPE = /^[A-Z]{3}$/;
export const CALLING_CODE_SHAPE = /^[1-9][0-9]{0,3}$/;

/**
 * The widest reminder lead time the schema allows — two weeks, matching
 * `businesses_reminder_lead_range` in `scripts/sql/007_notifications.sql`. Kept beside
 * the other schema-mirroring constants so the form and the CHECK cannot drift apart.
 *
 * Note what this bound does NOT cover: "no reminders at all" is the column being NULL,
 * not a number in this range. 0 is a real answer — "at the appointment time".
 */
export const REMINDER_LEAD_MAX_MIN = 20160;

/** A best-effort slug from a business name, for the onboarding field's initial value. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Combining marks, written as escapes: they are invisible in source otherwise.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

// ---------------------------------------------------------------------------
// The range check
// ---------------------------------------------------------------------------

export type TimeRange = { startMin: Minutes; endMin: Minutes };

/**
 * Parse a start and an end together, and refuse anything that does not describe real
 * elapsed time. This is the single definition of "a valid range" for weekly hours,
 * part-day closures and one-off date overrides alike; none of them re-derives it.
 */
export function parseTimeRange(
  startRaw: string,
  endRaw: string,
  fields: { start: string; end: string } = { start: 'start', end: 'end' },
): Validated<TimeRange> {
  const start = startRaw.trim();
  const end = endRaw.trim();

  if (start.length === 0) return invalid(fields.start, 'start_required');
  if (end.length === 0) return invalid(fields.end, 'end_required');

  const startMin = parseHhMm(start);
  if (startMin === null) return invalid(fields.start, 'time_shape');

  const endMin = parseHhMm(end, true);
  if (endMin === null) return invalid(fields.end, 'time_shape');

  // The whole point of the file. Equal is just as broken as inverted: a range that
  // blocks zero minutes reads as valid to a human and does nothing at all.
  if (endMin <= startMin) return invalid(fields.end, 'end_not_after_start');

  return valid({ startMin, endMin });
}

/** Does a candidate range overlap any range already on that day? */
export function overlapsExisting(candidate: TimeRange, existing: readonly TimeRange[]): boolean {
  return existing.some(
    (row) => candidate.startMin < row.endMin && candidate.endMin > row.startMin,
  );
}

// ---------------------------------------------------------------------------
// Small field helpers
// ---------------------------------------------------------------------------

export function requiredText(
  raw: string,
  field: string,
  code: string,
  maxLength = 200,
): Validated<string> {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return invalid(field, code);
  return valid(text.slice(0, maxLength));
}

export function optionalText(raw: string | null | undefined, maxLength = 2000): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  return text.length === 0 ? null : text.slice(0, maxLength);
}

export function boundedInt(
  raw: string | number,
  field: string,
  code: string,
  min: number,
  max: number,
): Validated<number> {
  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  if (text.length === 0) return invalid(field, code);
  if (!/^-?\d+$/.test(text)) return invalid(field, code);
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) return invalid(field, code);
  return valid(value);
}

// ---------------------------------------------------------------------------
// Database constraint violations, mapped back to the same field codes
// ---------------------------------------------------------------------------

type PgLikeError = { code?: unknown; constraint?: unknown };

function asPgError(err: unknown): { code: string; constraint: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as PgLikeError;
  if (typeof candidate.code !== 'string') return null;
  return {
    code: candidate.code,
    constraint: typeof candidate.constraint === 'string' ? candidate.constraint : '',
  };
}

/**
 * The last line of defence, translated.
 *
 * Postgres is the only layer that cannot be bypassed, so its CHECK and UNIQUE
 * violations must reach the owner as the same friendly field message the form would
 * have shown — never as a 500. An unmapped violation still resolves to a code rather
 * than null, so the UI shows *something* actionable.
 */
export function dbErrorCode(err: unknown): string | null {
  const pg = asPgError(err);
  if (!pg) return null;

  const byConstraint: Record<string, string> = {
    working_hours_ordered: 'end_not_after_start',
    date_overrides_ordered: 'end_not_after_start',
    closures_ordered: 'end_not_after_start',
    closures_range_complete: 'range_incomplete',
    services_duration_min_check: 'duration_range',
    services_price_minor_check: 'price_invalid',
    services_buffer_before_min_check: 'buffer_range',
    services_buffer_after_min_check: 'buffer_range',
    services_name_check: 'name_required',
    customers_name_check: 'name_required',
    customers_phone_e164_check: 'phone_invalid',
    customers_business_id_phone_e164_key: 'phone_taken',
    businesses_slug_key: 'slug_taken',
    businesses_slug_check: 'slug_shape',
    businesses_currency_check: 'currency_shape',
    businesses_calling_code_shape: 'calling_code_shape',
    businesses_name_check: 'name_required',
    businesses_slot_granularity_min_check: 'slot_range',
    businesses_min_notice_min_check: 'notice_range',
    businesses_max_advance_days_check: 'advance_range',
    businesses_cancellation_window_min_check: 'cancel_range',
    businesses_reminder_lead_range: 'reminder_range',
    bookings_service_id_fkey: 'in_use',
    bookings_customer_id_fkey: 'in_use',
  };

  const mapped = byConstraint[pg.constraint];
  if (mapped) return mapped;

  if (pg.code === '23505') return 'already_exists';
  if (pg.code === '23514') return 'check_failed';
  if (pg.code === '23503') return 'in_use';
  return null;
}
