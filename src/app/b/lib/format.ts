/**
 * Display formatting for the public booking flow.
 *
 * Two rules run through every function here.
 *
 * 1. **Wall clock, never server clock.** A time shown to a customer is the business's
 *    local time. Every conversion goes through Luxon with an explicit zone; nothing here
 *    reads the machine's timezone.
 *
 * 2. **Every LTR run is bidi-isolated.** A price, a phone number, a time range or a date
 *    range dropped raw into a Hebrew sentence renders with its internal order scrambled:
 *    `12:00–10:00` for what should read `10:00–12:00`, `19.7 — 13.7` for `13.7 — 19.7`.
 *    Both shipped to real users on the predecessor project. So the isolation is applied
 *    *here*, at the point the string is composed, rather than being something each
 *    screen has to remember. If you add a formatter that returns a mixed-script value,
 *    it wraps its result in `isolate()` too.
 *
 * Pure and clock-free: everything that varies arrives as an argument, so each branch is
 * reachable from a unit test.
 */
import { DateTime } from 'luxon';
import { isolate } from '@/lib/bidi';
import type { Lang } from '@/lib/i18n';

/**
 * `en-GB` rather than `en-US`: 24-hour times and day-before-month, which is what an
 * Israeli salon's English-reading customers expect and what matches the Hebrew side.
 */
export function localeTag(lang: Lang): string {
  return lang === 'he' ? 'he-IL' : 'en-GB';
}

/**
 * Substitute `{name}` placeholders in a dictionary string.
 *
 * Deliberately tiny, and deliberately leaves an unknown placeholder in place: a stray
 * `{business}` on screen is visibly wrong and gets fixed, whereas silently dropping it
 * produces a sentence with a hole in it that reads like bad copy rather than a bug.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * The Hebrew name when there is one and Hebrew is active, otherwise the default.
 *
 * A business or service with an empty `name_he` falls back rather than rendering a blank
 * heading — half the demo data in the predecessor project had no Hebrew name and the
 * Hebrew page showed empty cards.
 */
export function pickName(lang: Lang, name: string, nameHe: string | null | undefined): string {
  if (lang === 'he' && nameHe && nameHe.trim().length > 0) return nameHe;
  return name;
}

function dayStart(dateKey: string, timezone: string): DateTime {
  return DateTime.fromISO(dateKey, { zone: timezone }).startOf('day');
}

/** The business-local wall clock of an instant, as `HH:mm`. Isolated for RTL. */
export function formatTime(instant: Date, timezone: string): string {
  return isolate(DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm'));
}

/** Unisolated `HH:mm` — for building a longer run that gets isolated as a whole. */
export function plainTime(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('HH:mm');
}

/**
 * `10:00–10:30`, isolated as one run.
 *
 * Isolating the whole range rather than each end is the point: two separately-isolated
 * times either side of a dash still swap places in an RTL paragraph.
 */
export function formatTimeRange(start: Date, end: Date, timezone: string): string {
  return isolate(`${plainTime(start, timezone)}–${plainTime(end, timezone)}`);
}

/** e.g. `Thursday, 27 August 2026` / `יום חמישי, 27 באוגוסט 2026`. */
export function formatDateFull(dateKey: string, timezone: string, lang: Lang): string {
  return dayStart(dateKey, timezone).toJSDate().toLocaleDateString(localeTag(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
}

/** e.g. `Thu, 27 Aug` / `יום ה׳, 27 באוג׳`. Short enough for a summary line. */
export function formatDateMedium(dateKey: string, timezone: string, lang: Lang): string {
  return dayStart(dateKey, timezone).toJSDate().toLocaleDateString(localeTag(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });
}

/** e.g. `August 2026` — the calendar header. */
export function formatMonthTitle(dateKey: string, timezone: string, lang: Lang): string {
  return dayStart(dateKey, timezone).toJSDate().toLocaleDateString(localeTag(lang), {
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  });
}

/** The day-of-month number, as a plain string for a calendar cell. */
export function dayOfMonth(dateKey: string): string {
  return String(Number(dateKey.slice(8, 10)));
}

/**
 * Single-letter weekday headers, Sunday first — the business weekday convention used
 * throughout the schema (0 = Sunday).
 */
export function weekdayInitials(lang: Lang): string[] {
  // 2024-01-07 was a Sunday; any known Sunday works as the anchor.
  const anchor = DateTime.fromISO('2024-01-07', { zone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) =>
    anchor.plus({ days: i }).toJSDate().toLocaleDateString(localeTag(lang), {
      weekday: 'narrow',
      timeZone: 'UTC',
    }),
  );
}

/** Full weekday names, Sunday first — used as the accessible label for the headers. */
export function weekdayNames(lang: Lang): string[] {
  const anchor = DateTime.fromISO('2024-01-07', { zone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) =>
    anchor.plus({ days: i }).toJSDate().toLocaleDateString(localeTag(lang), {
      weekday: 'long',
      timeZone: 'UTC',
    }),
  );
}

/**
 * How many decimal places this currency actually uses, per ICU.
 *
 * Prices are stored in minor units, so ILS 12000 is ₪120.00 but JPY 12000 is ¥12,000.
 * Dividing by a hard-coded 100 would be wrong by two orders of magnitude for every
 * zero-decimal currency.
 */
function fractionDigits(currency: string, locale: string): number | null {
  try {
    const resolved = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).resolvedOptions();
    return resolved.maximumFractionDigits ?? 2;
  } catch {
    // Not a currency code ICU recognises.
    return null;
  }
}

/**
 * A price in the business's currency, isolated for RTL.
 *
 * Falls back to `<amount> <CODE>` for a currency ICU does not know rather than throwing:
 * a booking page that 500s because someone typed an odd currency code in settings is a
 * far worse outcome than an unstyled price.
 */
export function formatPrice(priceMinor: number, currency: string, lang: Lang): string {
  const locale = localeTag(lang);
  const digits = fractionDigits(currency, locale);

  if (digits === null) {
    return isolate(`${(priceMinor / 100).toFixed(2)} ${currency}`);
  }

  const major = priceMinor / 10 ** digits;
  return isolate(
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major),
  );
}

/**
 * A duration in words: `30 min`, `1 hr 30 min`, `שעה וחצי`-adjacent Hebrew forms.
 *
 * Hebrew has real dual forms (`שעתיים`, `יומיים`) and a customer notices immediately
 * when software writes `2 שעות`. Handled explicitly rather than through a plural library
 * — there are five cases and they are all here.
 */
export function humaniseMinutes(totalMinutes: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round(totalMinutes));

  if (minutes >= 1440 && minutes % 1440 === 0) {
    return humaniseDays(minutes / 1440, lang);
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (lang === 'he') {
    const hourPart = hours === 0 ? '' : hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`;
    const minutePart = rest === 0 ? '' : rest === 1 ? 'דקה' : `${rest} דקות`;
    if (hourPart && minutePart) return `${hourPart} ו-${minutePart}`;
    return hourPart || minutePart || '0 דקות';
  }

  const hourPart = hours === 0 ? '' : hours === 1 ? '1 hr' : `${hours} hr`;
  const minutePart = rest === 0 ? '' : `${rest} min`;
  if (hourPart && minutePart) return `${hourPart} ${minutePart}`;
  return hourPart || minutePart || '0 min';
}

export function humaniseDays(totalDays: number, lang: Lang): string {
  const days = Math.max(0, Math.round(totalDays));
  if (lang === 'he') {
    if (days === 1) return 'יום';
    if (days === 2) return 'יומיים';
    return `${days} ימים`;
  }
  return days === 1 ? '1 day' : `${days} days`;
}

/** A duration for display inside a sentence or a pill. Isolated: it contains digits. */
export function formatDuration(minutes: number, lang: Lang): string {
  return isolate(humaniseMinutes(minutes, lang));
}

/** A phone number is an LTR run wherever it appears. */
export function formatPhone(e164: string): string {
  return isolate(e164);
}

/**
 * `27 Aug – 3 Sep`, isolated as one run.
 *
 * The canonical example of the bug this module exists to prevent: two dates either side
 * of an en dash, rendered inside Hebrew, come out reversed without the isolate.
 */
export function formatDateRange(
  fromKey: string,
  toKey: string,
  timezone: string,
  lang: Lang,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  };
  const locale = localeTag(lang);
  const from = dayStart(fromKey, timezone).toJSDate().toLocaleDateString(locale, opts);
  const to = dayStart(toKey, timezone).toJSDate().toLocaleDateString(locale, opts);
  return isolate(`${from} – ${to}`);
}

/** Month arithmetic for the calendar, in the business's timezone. */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function firstOfMonth(dateKey: string): string {
  return `${monthKeyOf(dateKey)}-01`;
}

export function lastOfMonth(dateKey: string, timezone: string): string {
  const end = dayStart(dateKey, timezone).endOf('month').toISODate();
  if (!end) throw new Error(`Invalid date key: ${dateKey}`);
  return end;
}

export function shiftMonths(dateKey: string, months: number, timezone: string): string {
  const shifted = dayStart(dateKey, timezone).startOf('month').plus({ months }).toISODate();
  if (!shifted) throw new Error(`Invalid date key: ${dateKey}`);
  return shifted;
}

/**
 * The grid a month calendar renders: whole weeks, Sunday-first, with the days that spill
 * over from the neighbouring months included so the grid is always rectangular.
 */
export function monthGrid(monthAnchor: string, timezone: string): string[] {
  const first = dayStart(firstOfMonth(monthAnchor), timezone);
  // Luxon: Monday = 1 … Sunday = 7. The modulo maps Sunday to 0, matching the schema's
  // weekday convention and the Sunday-first grid.
  const leading = first.weekday % 7;
  const start = first.minus({ days: leading });

  const lastDay = dayStart(monthAnchor, timezone).endOf('month');
  const totalDays = Math.ceil((leading + lastDay.day) / 7) * 7;

  return Array.from({ length: totalDays }, (_, i) => {
    const key = start.plus({ days: i }).toISODate();
    if (!key) throw new Error(`Invalid grid date at offset ${i}`);
    return key;
  });
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

export type SlotGroup = { part: PartOfDay; slots: string[] };

/**
 * Split a day's slots into morning / afternoon / evening, in order.
 *
 * A busy day at a salon offers thirty-odd times. As one undifferentiated grid that is a
 * wall of numbers to scan; split into three labelled blocks a customer can jump straight
 * to the part of the day they are free. Boundaries are on the business's wall clock, not
 * the reader's, for the same reason every other time here is.
 *
 * Empty groups are dropped, so a business that only opens in the evening does not render
 * two empty headings.
 */
export function groupSlotsByPartOfDay(isoSlots: string[], timezone: string): SlotGroup[] {
  const buckets: Record<PartOfDay, string[]> = { morning: [], afternoon: [], evening: [] };

  for (const iso of isoSlots) {
    const hour = DateTime.fromISO(iso, { zone: timezone }).hour;
    const part: PartOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    buckets[part].push(iso);
  }

  return (['morning', 'afternoon', 'evening'] as const)
    .filter((part) => buckets[part].length > 0)
    .map((part) => ({ part, slots: buckets[part] }));
}
