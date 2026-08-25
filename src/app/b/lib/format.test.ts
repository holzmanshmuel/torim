import { describe, expect, it } from 'vitest';
import {
  dayOfMonth,
  fill,
  firstOfMonth,
  formatDateFull,
  formatDateMedium,
  formatDateRange,
  formatDuration,
  formatPhone,
  formatPrice,
  formatTime,
  formatTimeRange,
  groupSlotsByPartOfDay,
  humaniseDays,
  humaniseMinutes,
  lastOfMonth,
  localeTag,
  monthGrid,
  monthKeyOf,
  pickName,
  plainTime,
  shiftMonths,
  weekdayInitials,
  weekdayNames,
} from './format';

const TZ = 'Asia/Jerusalem';

/** U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE. */
const FSI = '\u2068';
const PDI = '\u2069';

function isIsolated(value: string): boolean {
  return value.startsWith(FSI) && value.endsWith(PDI);
}

function unwrap(value: string): string {
  return value.slice(1, -1);
}

describe('bidi isolation', () => {
  // This is the class of bug the whole module exists to prevent: `12:00–10:00` and
  // `19.7 — 13.7` both shipped to real Hebrew-reading users on the predecessor project.
  const start = new Date('2026-08-27T07:00:00Z'); // 10:00 in Jerusalem
  const end = new Date('2026-08-27T07:30:00Z');

  it('isolates a time', () => {
    expect(isIsolated(formatTime(start, TZ))).toBe(true);
  });

  it('isolates a time range as ONE run, keeping start before end', () => {
    const range = formatTimeRange(start, end, TZ);
    expect(isIsolated(range)).toBe(true);
    expect(unwrap(range)).toBe('10:00–10:30');
    // Isolating each end separately would not help: there must be exactly one pair.
    expect(range.split(FSI)).toHaveLength(2);
  });

  it('isolates a date range as one run', () => {
    const range = formatDateRange('2026-07-13', '2026-07-19', TZ, 'he');
    expect(isIsolated(range)).toBe(true);
    expect(range.split(FSI)).toHaveLength(2);
  });

  it('isolates a price', () => {
    expect(isIsolated(formatPrice(12_000, 'ILS', 'he'))).toBe(true);
  });

  it('isolates a phone number', () => {
    const phone = formatPhone('+972501234567');
    expect(isIsolated(phone)).toBe(true);
    expect(unwrap(phone)).toBe('+972501234567');
  });

  it('isolates a duration', () => {
    expect(isIsolated(formatDuration(30, 'he'))).toBe(true);
  });
});

describe('wall-clock times', () => {
  it('renders the business timezone, not the machine one', () => {
    const instant = new Date('2026-08-27T07:00:00Z');
    expect(plainTime(instant, 'Asia/Jerusalem')).toBe('10:00');
    expect(plainTime(instant, 'UTC')).toBe('07:00');
    expect(plainTime(instant, 'America/New_York')).toBe('03:00');
  });

  it('uses a 24-hour clock in both languages', () => {
    const evening = new Date('2026-08-27T16:45:00Z'); // 19:45 Jerusalem
    expect(plainTime(evening, TZ)).toBe('19:45');
  });
});

describe('formatPrice', () => {
  it('divides by the right power of ten for the currency', () => {
    // ILS has two decimal places, so 12000 minor units is 120.00.
    expect(unwrap(formatPrice(12_000, 'ILS', 'en'))).toContain('120.00');
    // JPY has none, so 12000 minor units is 12,000 — not 120.
    const yen = unwrap(formatPrice(12_000, 'JPY', 'en'));
    expect(yen).toContain('12,000');
    expect(yen).not.toContain('120.00');
  });

  it('falls back rather than throwing on a malformed currency code', () => {
    // ICU tolerates any well-formed three-letter code (it just prints it), so the
    // fallback is only reachable for something that is not a currency code at all —
    // which is exactly the sort of thing that ends up in a settings field.
    expect(unwrap(formatPrice(12_000, 'XX', 'en'))).toBe('120.00 XX');
    expect(unwrap(formatPrice(12_000, '', 'en'))).toBe('120.00 ');
    // A code ICU does not recognise but can still render must not hit the fallback.
    expect(unwrap(formatPrice(12_000, 'ZZZ', 'en'))).toContain('120.00');
  });

  it('handles a free service', () => {
    expect(unwrap(formatPrice(0, 'ILS', 'en'))).toContain('0.00');
  });
});

describe('humaniseMinutes', () => {
  it('English', () => {
    expect(humaniseMinutes(0, 'en')).toBe('0 min');
    expect(humaniseMinutes(30, 'en')).toBe('30 min');
    expect(humaniseMinutes(60, 'en')).toBe('1 hr');
    expect(humaniseMinutes(90, 'en')).toBe('1 hr 30 min');
    expect(humaniseMinutes(120, 'en')).toBe('2 hr');
    expect(humaniseMinutes(1440, 'en')).toBe('1 day');
    expect(humaniseMinutes(2880, 'en')).toBe('2 days');
  });

  it('Hebrew uses the dual form rather than "2 hours"', () => {
    expect(humaniseMinutes(60, 'he')).toBe('שעה');
    expect(humaniseMinutes(120, 'he')).toBe('שעתיים');
    expect(humaniseMinutes(180, 'he')).toBe('3 שעות');
    expect(humaniseMinutes(30, 'he')).toBe('30 דקות');
    expect(humaniseMinutes(1, 'he')).toBe('דקה');
    expect(humaniseMinutes(90, 'he')).toBe('שעה ו-30 דקות');
    expect(humaniseDays(2, 'he')).toBe('יומיים');
    expect(humaniseDays(1, 'he')).toBe('יום');
    expect(humaniseDays(60, 'he')).toBe('60 ימים');
  });

  it('rounds rather than printing a fraction', () => {
    expect(humaniseMinutes(29.6, 'en')).toBe('30 min');
  });
});

describe('calendar arithmetic', () => {
  it('produces whole Sunday-first weeks covering the month', () => {
    // 2026-08-01 is a Saturday, so the grid starts on Sunday 2026-07-26.
    const grid = monthGrid('2026-08-15', TZ);
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe('2026-07-26');
    expect(grid).toContain('2026-08-01');
    expect(grid).toContain('2026-08-31');
    // Strictly ascending, no gaps and no repeats.
    expect(new Set(grid).size).toBe(grid.length);
    expect([...grid].sort()).toEqual(grid);
  });

  it('starts exactly on the first when the first is a Sunday', () => {
    // 2026-02-01 is a Sunday.
    expect(monthGrid('2026-02-10', TZ)[0]).toBe('2026-02-01');
  });

  it('handles February in a leap year', () => {
    // 2028-02-01 is a Tuesday, so the grid opens on Sunday 2028-01-30 and, being whole
    // weeks, spills a few days into March. Those neighbouring-month cells render blank —
    // the grid stays rectangular, which is what stops the calendar reflowing each month.
    const grid = monthGrid('2028-02-01', TZ);
    expect(grid[0]).toBe('2028-01-30');
    expect(grid).toContain('2028-02-29');
    expect(grid.length % 7).toBe(0);
    expect(grid.filter((day) => day.startsWith('2028-02'))).toHaveLength(29);
  });

  it('never drops the month boundary across a DST transition', () => {
    // Israel moves the clocks in late March; the grid is calendar arithmetic and must
    // be unaffected.
    const grid = monthGrid('2026-03-15', TZ);
    expect(grid).toContain('2026-03-27');
    expect(grid).toContain('2026-03-31');
    expect(new Set(grid).size).toBe(grid.length);
  });

  it('month helpers', () => {
    expect(monthKeyOf('2026-08-27')).toBe('2026-08');
    expect(firstOfMonth('2026-08-27')).toBe('2026-08-01');
    expect(lastOfMonth('2026-08-27', TZ)).toBe('2026-08-31');
    expect(lastOfMonth('2028-02-05', TZ)).toBe('2028-02-29');
    expect(shiftMonths('2026-12-15', 1, TZ)).toBe('2027-01-01');
    expect(shiftMonths('2026-01-15', -1, TZ)).toBe('2025-12-01');
    // Stepping from a 31-day month into a 30-day one must not overflow into the next.
    expect(shiftMonths('2026-01-31', 1, TZ)).toBe('2026-02-01');
    expect(dayOfMonth('2026-08-07')).toBe('7');
  });
});

describe('localised names', () => {
  it('weekday headers are seven entries, Sunday first', () => {
    expect(weekdayInitials('en')).toHaveLength(7);
    expect(weekdayNames('en')[0]).toBe('Sunday');
    expect(weekdayNames('en')[6]).toBe('Saturday');
    expect(weekdayNames('he')).toHaveLength(7);
  });

  it('renders the date in the business timezone and active language', () => {
    expect(formatDateFull('2026-08-27', TZ, 'en')).toBe('Thursday, 27 August 2026');
    expect(formatDateFull('2026-08-27', TZ, 'he')).toContain('2026');
    expect(formatDateMedium('2026-08-27', TZ, 'en')).toContain('27');
  });

  it('picks the Hebrew name only when there is one and Hebrew is active', () => {
    expect(pickName('he', 'Haircut', 'תספורת')).toBe('תספורת');
    expect(pickName('he', 'Haircut', null)).toBe('Haircut');
    expect(pickName('he', 'Haircut', '   ')).toBe('Haircut');
    expect(pickName('en', 'Haircut', 'תספורת')).toBe('Haircut');
  });

  it('maps languages to locales', () => {
    expect(localeTag('he')).toBe('he-IL');
    expect(localeTag('en')).toBe('en-GB');
  });
});

describe('fill', () => {
  it('substitutes named placeholders', () => {
    expect(fill('{business} is closed on {date}.', { business: 'Lumen', date: 'Sat' })).toBe(
      'Lumen is closed on Sat.',
    );
  });

  it('substitutes numbers', () => {
    expect(fill('{n} times available', { n: 4 })).toBe('4 times available');
  });

  it('leaves an unknown placeholder visible rather than silently blank', () => {
    expect(fill('hello {nobody}', {})).toBe('hello {nobody}');
  });

  it('replaces every occurrence', () => {
    expect(fill('{a}-{a}', { a: 'x' })).toBe('x-x');
  });
});

describe('groupSlotsByPartOfDay', () => {
  const iso = (hhmm: string) => `2026-08-27T${hhmm}:00+03:00`; // Jerusalem in August

  it('splits on the business wall clock, in order', () => {
    const groups = groupSlotsByPartOfDay(
      [iso('09:00'), iso('11:45'), iso('12:00'), iso('16:45'), iso('17:00'), iso('19:30')],
      TZ,
    );
    expect(groups.map((g) => g.part)).toEqual(['morning', 'afternoon', 'evening']);
    expect(groups[0].slots).toHaveLength(2);
    expect(groups[1].slots).toHaveLength(2);
    expect(groups[2].slots).toHaveLength(2);
  });

  it('uses the business timezone, not the reader\'s', () => {
    // 07:00Z is 10:00 in Jerusalem (morning) but 03:00 in New York (still "morning"
    // there too) — pick a case where they genuinely differ: 20:00Z is 23:00 Jerusalem
    // (evening) and 16:00 New York (afternoon).
    const instant = '2026-08-27T20:00:00Z';
    expect(groupSlotsByPartOfDay([instant], 'Asia/Jerusalem')[0].part).toBe('evening');
    expect(groupSlotsByPartOfDay([instant], 'America/New_York')[0].part).toBe('afternoon');
  });

  it('drops empty groups so an evening-only business gets one heading', () => {
    const groups = groupSlotsByPartOfDay([iso('18:00'), iso('18:30')], TZ);
    expect(groups).toHaveLength(1);
    expect(groups[0].part).toBe('evening');
  });

  it('returns nothing for no slots', () => {
    expect(groupSlotsByPartOfDay([], TZ)).toEqual([]);
  });

  it('keeps every slot exactly once', () => {
    const slots = Array.from({ length: 31 }, (_, i) =>
      iso(`${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`),
    );
    const flat = groupSlotsByPartOfDay(slots, TZ).flatMap((g) => g.slots);
    expect(flat).toEqual(slots);
  });
});
