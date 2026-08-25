/**
 * Formatting rules that a screenshot would not catch.
 *
 * The bidi assertions are the important ones: an unisolated time range renders with its
 * two ends swapped inside Hebrew text, silently, and looks perfectly fine in English.
 */
import { describe, expect, it } from 'vitest';
import {
  clock,
  clockRange,
  clockValue,
  countLabel,
  dateRange,
  dayHeading,
  interpolate,
  minorPerMajor,
  minutesRange,
  minutesToHhMm,
  money,
  moneyInputValue,
  nextSlotValue,
  parseMoneyToMinor,
  phone,
  telHref,
  todayKey,
  weekStart,
} from './format';
import { localToInstant } from '@/lib/time';

const TZ = 'Asia/Jerusalem';
/** A Monday. The schema numbers weekdays from Sunday, so its Sunday is the 14th. */
const MONDAY = '2026-06-15';

// Written as escapes, never as the literal characters — they are invisible in source.
const FSI = '\u2068';
const PDI = '\u2069';

function isIsolated(value: string): boolean {
  return value.startsWith(FSI) && value.endsWith(PDI);
}

function bare(value: string): string {
  return value.replaceAll(FSI, '').replaceAll(PDI, '');
}

describe('clock formatting', () => {
  it('renders 24-hour local time in the business timezone, isolated', () => {
    const at = localToInstant(MONDAY, 9 * 60 + 30, TZ);
    expect(bare(clock(at, TZ))).toBe('09:30');
    expect(isIsolated(clock(at, TZ))).toBe(true);
  });

  it('uses the business timezone, not the machine one', () => {
    const at = localToInstant(MONDAY, 9 * 60, TZ);
    expect(bare(clock(at, 'UTC'))).toBe('06:00');
  });

  it('keeps a form value free of isolate characters', () => {
    const at = localToInstant(MONDAY, 9 * 60, TZ);
    expect(clockValue(at, TZ)).toBe('09:00');
  });

  it('isolates a time range as ONE run so its ends cannot swap in Hebrew', () => {
    const from = localToInstant(MONDAY, 9 * 60, TZ);
    const to = localToInstant(MONDAY, 10 * 60 + 15, TZ);
    const range = clockRange(from, to, TZ);
    expect(bare(range)).toBe('09:00–10:15');
    expect(isIsolated(range)).toBe(true);
    // One isolate pair around the whole range, not one per end.
    expect(range.split(FSI)).toHaveLength(2);
  });

  it('formats minutes-from-midnight, including the end-of-day 1440', () => {
    expect(minutesToHhMm(0)).toBe('00:00');
    expect(minutesToHhMm(570)).toBe('09:30');
    expect(minutesToHhMm(1439)).toBe('23:59');
    expect(minutesToHhMm(1440)).toBe('24:00');
    expect(bare(minutesRange(540, 1020))).toBe('09:00–17:00');
  });
});

describe('date formatting', () => {
  it('isolates a date range as one run', () => {
    const range = dateRange('2026-07-13', '2026-07-19', 'he');
    expect(isIsolated(range)).toBe(true);
    expect(range.split(FSI)).toHaveLength(2);
    expect(bare(range)).toContain('–');
  });

  it('names the weekday from the app dictionary, so every screen agrees', () => {
    const t = (key: string) => (key === 'wd.1' ? 'Monday' : key);
    expect(dayHeading(MONDAY, 'en', TZ, t)).toContain('Monday');
  });

  it('does not roll a date key onto the previous day in a western timezone', () => {
    const t = (key: string) => key;
    // Formatted at UTC noon precisely so this cannot happen.
    expect(dayHeading('2026-01-01', 'en', TZ, t)).toContain('1');
    expect(dayHeading('2026-01-01', 'en', TZ, t)).toMatch(/January/);
  });

  it('walks a week back to Sunday, matching the schema weekday numbering', () => {
    expect(weekStart(MONDAY, TZ)).toBe('2026-06-14');
    expect(weekStart('2026-06-14', TZ)).toBe('2026-06-14');
    expect(weekStart('2026-06-20', TZ)).toBe('2026-06-14');
  });

  it('reads today in the business timezone', () => {
    expect(todayKey(TZ)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('money', () => {
  it('isolates a price', () => {
    expect(isIsolated(money(12000, 'ILS', 'he'))).toBe(true);
  });

  it('divides by the currency’s own minor units, not by a hardcoded 100', () => {
    expect(bare(money(12000, 'ILS', 'en'))).toContain('120');
    expect(minorPerMajor('ILS')).toBe(100);
    // Yen has no minor unit at all; dividing by 100 would show ¥120 as ¥1.20.
    expect(minorPerMajor('JPY')).toBe(1);
    expect(bare(money(120, 'JPY', 'en'))).toContain('120');
  });

  it('survives a currency code Intl does not know', () => {
    expect(() => money(12000, 'XX', 'en')).not.toThrow();
    expect(bare(money(12000, 'XX', 'en'))).toContain('XX');
  });

  it('round-trips an editable price', () => {
    expect(moneyInputValue(12000, 'ILS')).toBe('120');
    expect(moneyInputValue(12050, 'ILS')).toBe('120.50');
    expect(parseMoneyToMinor('120', 'ILS')).toBe(12000);
    expect(parseMoneyToMinor('120.50', 'ILS')).toBe(12050);
    expect(parseMoneyToMinor('120,50', 'ILS')).toBe(12050);
    expect(parseMoneyToMinor(' 120 ', 'ILS')).toBe(12000);
    expect(parseMoneyToMinor('0', 'ILS')).toBe(0);
  });

  it('refuses a price that is not a usable number', () => {
    expect(parseMoneyToMinor('', 'ILS')).toBeNull();
    expect(parseMoneyToMinor('abc', 'ILS')).toBeNull();
    expect(parseMoneyToMinor('-5', 'ILS')).toBeNull();
    expect(parseMoneyToMinor('.', 'ILS')).toBeNull();
  });
});

describe('phone', () => {
  it('isolates a display number but never the tel: target', () => {
    expect(isIsolated(phone('+972501112222'))).toBe(true);
    expect(telHref('+972501112222')).toBe('tel:+972501112222');
  });
});

describe('helpers', () => {
  it('interpolates, and leaves an unknown placeholder visible', () => {
    expect(interpolate('Cancel {name}?', { name: 'Dana' })).toBe('Cancel Dana?');
    expect(interpolate('{a} and {b}', { a: '1' })).toBe('1 and {b}');
  });

  it('rounds to the next slot boundary', () => {
    const t = (h: number, m: number) => localToInstant(MONDAY, h * 60 + m, TZ);
    expect(nextSlotValue(t(9, 7), TZ, 15)).toBe('09:15');
    expect(nextSlotValue(t(9, 0), TZ, 15)).toBe('09:00');
    expect(nextSlotValue(t(9, 31), TZ, 30)).toBe('10:00');
    // Past the last boundary of the day, offer the start of the next one.
    expect(nextSlotValue(t(23, 50), TZ, 15)).toBe('00:00');
  });

  it('picks a plural key without an i18n library', () => {
    const t = (key: string) =>
      ({ 'z': 'none', 'o': 'one', 'm': '{count} things' })[key] ?? key;
    expect(countLabel(0, t, { zero: 'z', one: 'o', many: 'm' })).toBe('none');
    expect(countLabel(1, t, { zero: 'z', one: 'o', many: 'm' })).toBe('one');
    expect(countLabel(4, t, { zero: 'z', one: 'o', many: 'm' })).toBe('4 things');
    // With no zero key, zero falls through to the many form.
    expect(countLabel(0, t, { one: 'o', many: 'm' })).toBe('0 things');
  });
});
