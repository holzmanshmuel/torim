/**
 * Every conversion between a business's wall clock and an absolute instant goes through
 * here. Nothing else in the codebase may construct a local time.
 *
 * Two rules this module exists to enforce:
 *
 *  1. Wall-clock times are built by SETTING the hour and minute, never by adding minutes
 *     to local midnight. Adding adds absolute duration, so on a 23-hour day every
 *     appointment after the transition lands an hour late — and nothing errors.
 *  2. A "date" here is always a business-local date key (YYYY-MM-DD), never a Date. Day
 *     boundaries are a property of the business's timezone, not of the server's or the
 *     browser's.
 */
import { DateTime } from 'luxon';

/** Minutes from local midnight. 0 = 00:00, 1439 = 23:59. */
export type Minutes = number;

/** A business-local calendar day, YYYY-MM-DD. */
export type DateKey = string;

function localMidnight(dateKey: DateKey, timezone: string): DateTime {
  const dt = DateTime.fromISO(dateKey, { zone: timezone }).startOf('day');
  if (!dt.isValid) {
    throw new Error(`Invalid date "${dateKey}" in ${timezone}: ${dt.invalidReason}`);
  }
  return dt;
}

/**
 * The absolute instant at which a given wall-clock time occurs in a business's timezone.
 *
 * Throws for a time that does not exist (the hour skipped at a spring-forward
 * transition) rather than silently sliding it to a different time than was asked for.
 * Ambiguous times at a fall-back transition resolve to the first occurrence.
 */
export function localToInstant(dateKey: DateKey, minutes: Minutes, timezone: string): Date {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new Error(`Minutes must be an integer between 0 and 1439, got ${minutes}`);
  }

  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  const dt = localMidnight(dateKey, timezone).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });

  // Luxon slides a nonexistent local time forward across the DST gap. Detect that by
  // checking the fields came back as asked, and refuse rather than book a phantom hour.
  if (dt.hour !== hour || dt.minute !== minute) {
    throw new Error(
      `${dateKey} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ` +
        `does not exist in ${timezone} — the clocks change that morning.`,
    );
  }

  return dt.toJSDate();
}

/** The business-local calendar day an instant falls on. */
export function instantToDateKey(instant: Date, timezone: string): DateKey {
  const key = DateTime.fromJSDate(instant, { zone: timezone }).toISODate();
  if (!key) throw new Error('Invalid instant');
  return key;
}

/** Minutes from local midnight for an instant, in the business's timezone. */
export function instantToMinutes(instant: Date, timezone: string): Minutes {
  const dt = DateTime.fromJSDate(instant, { zone: timezone });
  return dt.hour * 60 + dt.minute;
}

/** Local weekday, numbered from Sunday: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateKey: DateKey, timezone: string): number {
  // Luxon numbers Monday=1 … Sunday=7; the modulo maps Sunday to 0.
  return localMidnight(dateKey, timezone).weekday % 7;
}

/**
 * Shift a date key by whole days.
 * Done in UTC on purpose: calendar-day arithmetic must not be perturbed by a DST
 * transition inside the range.
 */
export function addDays(dateKey: DateKey, days: number): DateKey {
  const dt = DateTime.fromISO(dateKey, { zone: 'UTC' });
  if (!dt.isValid) throw new Error(`Invalid date "${dateKey}": ${dt.invalidReason}`);
  const shifted = dt.plus({ days }).toISODate();
  if (!shifted) throw new Error(`Invalid date "${dateKey}"`);
  return shifted;
}

/** Every date key from `from` to `to`, inclusive. Empty if the range is inverted. */
export function dateKeysBetween(from: DateKey, to: DateKey): DateKey[] {
  const start = DateTime.fromISO(from, { zone: 'UTC' });
  const end = DateTime.fromISO(to, { zone: 'UTC' });
  if (!start.isValid) throw new Error(`Invalid date "${from}": ${start.invalidReason}`);
  if (!end.isValid) throw new Error(`Invalid date "${to}": ${end.invalidReason}`);

  const keys: DateKey[] = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    const key = d.toISODate();
    if (key) keys.push(key);
  }
  return keys;
}
