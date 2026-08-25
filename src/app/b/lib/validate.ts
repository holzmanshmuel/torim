/**
 * Input validation for the public booking surface.
 *
 * Server Actions and Route Handlers are POST/GET endpoints reachable by anyone who can
 * send the request — the UI is not a gate. Everything that reaches `@/lib/availability`,
 * `@/lib/public-booking` or `@/lib/manage` passes through here first.
 *
 * The rule these functions exist to enforce: a date like `2026-02-31` is *shaped* like a
 * date and will happily concatenate into SQL as a `::date` cast that throws at the
 * database — or, worse, be silently coerced somewhere upstream. Shape checks are not
 * enough; every date key is round-tripped through Luxon and compared back to its input,
 * so only a real calendar day survives.
 *
 * Pure and dependency-light on purpose: every branch is reachable from a unit test with
 * no database and no request.
 */
import { DateTime } from 'luxon';

/** YYYY-MM-DD, structurally. Calendar validity is checked separately. */
const DATE_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical lowercase UUID, as Postgres renders one. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Booking-page slugs: lowercase, digits, single hyphens, 1–63 characters. */
const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Manage tokens are 64 lowercase hex characters — same shape `@/lib/manage` enforces. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * The widest window one availability request may ask for.
 *
 * The calendar fetches a month at a time, so 62 days covers any month plus the leading
 * and trailing days a grid shows. It exists so a crafted request cannot ask for ten
 * years of slot generation in one call — that is a denial-of-service vector, and the
 * rate limiter alone would not stop a single very expensive request.
 */
export const MAX_RANGE_DAYS = 62;

export const MAX_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 280;

/** Instants outside this range are not a booking; they are someone probing. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * A real calendar day in YYYY-MM-DD form, or null.
 *
 * `2026-02-31` and `2026-13-01` are rejected: Luxon parses them as invalid, and the
 * round-trip comparison catches anything a future Luxon might decide to normalise
 * instead of reject.
 */
export function parseDateKey(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null || !DATE_KEY_SHAPE.test(raw)) return null;

  const dt = DateTime.fromISO(raw, { zone: 'UTC' });
  if (!dt.isValid) return null;
  if (dt.toISODate() !== raw) return null;
  if (dt.year < MIN_YEAR || dt.year > MAX_YEAR) return null;

  return raw;
}

export type DateRange = { from: string; to: string };

/**
 * An ordered, bounded pair of date keys.
 *
 * Inverted ranges are rejected rather than swapped: a caller that sent them the wrong
 * way round has a bug, and quietly "fixing" it hides the bug while still running the
 * query.
 */
export function parseDateRange(
  from: unknown,
  to: unknown,
  maxDays: number = MAX_RANGE_DAYS,
): DateRange | null {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (start === null || end === null) return null;
  if (start > end) return null;

  const spanDays =
    DateTime.fromISO(end, { zone: 'UTC' }).diff(DateTime.fromISO(start, { zone: 'UTC' }), 'days')
      .days + 1;
  if (spanDays > maxDays) return null;

  return { from: start, to: end };
}

export function parseUuid(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  return UUID_SHAPE.test(lower) ? lower : null;
}

export function parseSlug(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  return SLUG_SHAPE.test(lower) ? lower : null;
}

export function parseManageToken(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  return TOKEN_SHAPE.test(raw) ? raw : null;
}

/**
 * An absolute instant from an ISO 8601 string, or null.
 *
 * Requires an explicit offset (`Z` or `±HH:MM`). A bare local time such as
 * `2026-08-27T10:00` means a different instant depending on who parses it, which is
 * exactly the ambiguity `@/lib/time` exists to keep out of this codebase.
 */
export function parseInstant(value: unknown): Date | null {
  const raw = asString(value);
  if (raw === null) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return null;

  const dt = DateTime.fromISO(raw, { setZone: true });
  if (!dt.isValid) return null;
  if (dt.year < MIN_YEAR || dt.year > MAX_YEAR) return null;

  return dt.toJSDate();
}

/**
 * A usable customer name, or null.
 *
 * Only trims and length-checks. Bidi control stripping and whitespace collapsing happen
 * in `@/lib/public-booking`, which is the layer that actually writes the row — doing it
 * twice would mean two places to keep in step.
 */
export function parseName(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

/** An optional note. Absent and empty both mean "no note"; over-long is a rejection. */
export function parseNote(value: unknown): { ok: true; note?: string } | { ok: false } {
  if (value === undefined || value === null) return { ok: true };
  const raw = asString(value);
  if (raw === null) return { ok: false };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true };
  if (trimmed.length > MAX_NOTE_LENGTH) return { ok: false };
  return { ok: true, note: trimmed };
}

/**
 * Phone input is deliberately NOT validated here — `normalisePhone` in `@/lib/phone`
 * owns that, and it is the only thing that knows the business's default calling code.
 * This just refuses input long enough to be an attack rather than a typo.
 */
export function parsePhoneInput(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  return trimmed;
}

/**
 * Whole minutes to whole minutes, rounded up, floor of 1.
 *
 * Used for "try again in N minutes". Never 0: "try again in 0 minutes" reads as a bug,
 * and rounding a 20-second wait up to a minute costs the customer nothing.
 */
export function retryAfterMinutes(retryAfterMs: number): number {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return 1;
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}
