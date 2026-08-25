/**
 * Display formatting for the admin app.
 *
 * Two rules, both of which the predecessor project broke:
 *
 *  1. Every LTR run this app composes — a clock time, a time range, a date range, a
 *     price, a phone number — leaves here already wrapped in `isolate()`. Doing it at
 *     the point of composition rather than at each call site is the only version that
 *     stays true: a screen added later gets it for free.
 *  2. Nothing is formatted in the browser. Every one of these runs on the server with
 *     the *business's* timezone passed in explicitly, and the resulting string is sent
 *     to the client. A device set to another timezone therefore cannot shift an
 *     appointment by an hour on screen.
 *
 * Pure and dependency-light on purpose (luxon + the bidi helper), so every rule here is
 * unit-testable without a database, a request, or a rendered component.
 */
import { DateTime } from 'luxon';
import { isolate } from '@/lib/bidi';
import type { Lang } from '@/lib/i18n';
import { addDays, instantToDateKey, weekdayOf, type DateKey, type Minutes } from '@/lib/time';

/** En dash, not a hyphen: a range, and it survives being read aloud. */
const RANGE_SEP = '–';

/** BCP-47 tags for `Intl`. The app's two-letter `Lang` is not one on its own. */
const LOCALES: Record<Lang, string> = { en: 'en-GB', he: 'he-IL' };

export function localeOf(lang: Lang): string {
  return LOCALES[lang];
}

/**
 * `{name}` substitution for dictionary templates.
 *
 * A missing key leaves the placeholder visible rather than printing "undefined" — the
 * same reasoning as `getT` falling back to the key itself.
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

// ---------------------------------------------------------------------------
// Clock times
// ---------------------------------------------------------------------------

/** Minutes-from-midnight as HH:MM. Raw — for an `<input type="time">` value. */
export function minutesToHhMm(minutes: Minutes): string {
  const safe = Math.max(0, Math.min(1440, Math.trunc(minutes)));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 24-hour clock, always. Unambiguous in both markets and never 12 vs 00 confusion. */
export function clock(instant: Date, timezone: string): string {
  return isolate(DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm'));
}

/** Raw HH:MM for a form control — deliberately NOT isolated; it is a machine value. */
export function clockValue(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm');
}

export function clockRange(start: Date, end: Date, timezone: string): string {
  const from = DateTime.fromJSDate(start, { zone: timezone }).toFormat('HH:mm');
  const to = DateTime.fromJSDate(end, { zone: timezone }).toFormat('HH:mm');
  return isolate(`${from}${RANGE_SEP}${to}`);
}

export function minutesRange(startMin: Minutes, endMin: Minutes): string {
  return isolate(`${minutesToHhMm(startMin)}${RANGE_SEP}${minutesToHhMm(endMin)}`);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Today, in the business's timezone — never the server's or the browser's. */
export function todayKey(timezone: string): DateKey {
  return instantToDateKey(new Date(), timezone);
}

export function dateKeyOf(instant: Date, timezone: string): DateKey {
  return instantToDateKey(instant, timezone);
}

/** The Sunday on or before `dateKey`. The schema numbers weekdays from Sunday. */
export function weekStart(dateKey: DateKey, timezone: string): DateKey {
  return addDays(dateKey, -weekdayOf(dateKey, timezone));
}

function intlDate(dateKey: DateKey, lang: Lang, options: Intl.DateTimeFormatOptions): string {
  // Formatted at UTC noon: a date key is a calendar day with no time, and noon is far
  // enough from either midnight that no timezone can roll it onto the day before.
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALES[lang], { ...options, timeZone: 'UTC' }).format(date);
}

/** "15 Jun" / "15 ביוני". */
export function dayMonth(dateKey: DateKey, lang: Lang): string {
  return isolate(intlDate(dateKey, lang, { day: 'numeric', month: 'short' }));
}

/** "15 June 2026" / "15 ביוני 2026". */
export function dayMonthYear(dateKey: DateKey, lang: Lang): string {
  return isolate(intlDate(dateKey, lang, { day: 'numeric', month: 'long', year: 'numeric' }));
}

/** "15/06/2026" — the compact numeric form, always an LTR run. */
export function dateNumeric(dateKey: DateKey, lang: Lang): string {
  return isolate(intlDate(dateKey, lang, { day: '2-digit', month: '2-digit', year: 'numeric' }));
}

/** "15 Jun – 21 Jun" as ONE isolated run, so the two ends cannot swap in Hebrew. */
export function dateRange(from: DateKey, to: DateKey, lang: Lang): string {
  const a = intlDate(from, lang, { day: 'numeric', month: 'short' });
  const b = intlDate(to, lang, { day: 'numeric', month: 'short' });
  return isolate(`${a} ${RANGE_SEP} ${b}`);
}

/**
 * "Monday, 15 June" — weekday from the app's own dictionary so the day view, the week
 * view and every confirmation name the day identically.
 */
export function dayHeading(
  dateKey: DateKey,
  lang: Lang,
  timezone: string,
  t: (key: string) => string,
): string {
  const weekday = t(`wd.${weekdayOf(dateKey, timezone)}`);
  return `${weekday}, ${isolate(intlDate(dateKey, lang, { day: 'numeric', month: 'long' }))}`;
}

/** "Mon 15 Jun" — the compact form for a week column header. */
export function dayHeadingShort(
  dateKey: DateKey,
  lang: Lang,
  timezone: string,
  t: (key: string) => string,
): string {
  const weekday = t(`wd.short.${weekdayOf(dateKey, timezone)}`);
  return `${weekday} ${isolate(intlDate(dateKey, lang, { day: 'numeric', month: 'short' }))}`;
}

/**
 * "Monday, 15 June, 09:00" — the phrase a confirmation names an appointment with.
 * Both the date and the clock time are isolated in their own right.
 */
export function whenLabel(
  instant: Date,
  lang: Lang,
  timezone: string,
  t: (key: string) => string,
): string {
  const key = instantToDateKey(instant, timezone);
  return `${dayHeading(key, lang, timezone, t)}, ${clock(instant, timezone)}`;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Minor units to a display string.
 *
 * The number of minor digits comes from `Intl` rather than a hardcoded 100, so a
 * zero-decimal currency (JPY) is not silently divided by a hundred. An unknown currency
 * code makes `Intl` throw, which must not take a page down over a settings typo — so it
 * falls back to two decimals and the raw code.
 */
export function money(minor: number, currency: string, lang: Lang): string {
  const locale = LOCALES[lang];
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return isolate(formatter.format(minor / 10 ** digits));
  } catch {
    return isolate(`${(minor / 100).toFixed(2)} ${currency}`);
  }
}

/** How many minor units make one major unit for this currency (100 for most). */
export function minorPerMajor(currency: string): number {
  try {
    const digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

/** Major units for an editable form field: "120.5" for 12050 minor. Never isolated. */
export function moneyInputValue(minor: number, currency: string): string {
  const factor = minorPerMajor(currency);
  const value = minor / factor;
  return Number.isInteger(value) ? String(value) : value.toFixed(String(factor).length - 1);
}

/**
 * A typed price back to minor units, or null when it is not a usable number.
 * Accepts a comma decimal separator, because a Hebrew keyboard offers one.
 */
export function parseMoneyToMinor(input: string, currency: string): number | null {
  // \u00a0 / \u202f: the no-break spaces Intl uses as a currency group separator.
  const cleaned = input.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (cleaned.length === 0) return null;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * minorPerMajor(currency));
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/** E.164 for display. Isolated: a leading "+" beside Hebrew reorders without it. */
export function phone(e164: string): string {
  return isolate(e164);
}

/** `tel:` targets take the raw E.164 — isolate characters would break the dial. */
export function telHref(e164: string): string {
  return `tel:${e164}`;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * The next slot boundary at or after `now`, as HH:MM — the sensible default time for a
 * manual booking taken over the phone.
 */
export function nextSlotValue(now: Date, timezone: string, granularityMin: number): string {
  const step = granularityMin > 0 ? granularityMin : 15;
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const minutes = local.hour * 60 + local.minute;
  const rounded = Math.ceil(minutes / step) * step;
  // Past the end of the day, offer the start of the next one rather than "24:00".
  return minutesToHhMm(rounded >= 1440 ? 0 : rounded);
}

/** Pluralisation without an i18n library: three keys, chosen here in one place. */
export function countLabel(
  count: number,
  t: (key: string) => string,
  keys: { zero?: string; one: string; many: string },
): string {
  if (count === 0 && keys.zero) return t(keys.zero);
  if (count === 1) return t(keys.one);
  return interpolate(t(keys.many), { count });
}
