import { describe, expect, it } from 'vitest';
import { isOutsideOpeningHours, mergeWindows, openWindowsForDate } from './opening-hours';

const TZ = 'Asia/Jerusalem';
/** 2026-06-15 is a Monday; the schema numbers Sunday as 0, so Monday is weekday 1. */
const MONDAY = '2026-06-15';
const SUNDAY = '2026-06-14';

const weekly = [
  { weekday: 1, startMin: 540, endMin: 780 },
  { weekday: 1, startMin: 840, endMin: 1020 },
];

describe('openWindowsForDate', () => {
  it('reads the weekly template for that weekday', () => {
    expect(openWindowsForDate({ dateKey: MONDAY, timezone: TZ, workingHours: weekly })).toEqual([
      { startMin: 540, endMin: 780 },
      { startMin: 840, endMin: 1020 },
    ]);
  });

  it('is closed on a weekday with no rows', () => {
    expect(openWindowsForDate({ dateKey: SUNDAY, timezone: TZ, workingHours: weekly })).toEqual([]);
  });

  it('lets a date override REPLACE the weekly template, not extend it', () => {
    const windows = openWindowsForDate({
      dateKey: MONDAY,
      timezone: TZ,
      workingHours: weekly,
      dateOverrides: [{ onDate: MONDAY, startMin: 840, endMin: 1020 }],
    });
    expect(windows).toEqual([{ startMin: 840, endMin: 1020 }]);
  });

  it('opens a normally-closed day through an override', () => {
    const windows = openWindowsForDate({
      dateKey: SUNDAY,
      timezone: TZ,
      workingHours: weekly,
      dateOverrides: [{ onDate: SUNDAY, startMin: 600, endMin: 720 }],
    });
    expect(windows).toEqual([{ startMin: 600, endMin: 720 }]);
  });

  it('subtracts a part-day closure, splitting a window in two', () => {
    const windows = openWindowsForDate({
      dateKey: MONDAY,
      timezone: TZ,
      workingHours: [{ weekday: 1, startMin: 540, endMin: 1020 }],
      closures: [{ onDate: MONDAY, startMin: 720, endMin: 780 }],
    });
    expect(windows).toEqual([
      { startMin: 540, endMin: 720 },
      { startMin: 780, endMin: 1020 },
    ]);
  });

  it('a whole-day closure removes everything, overrides included', () => {
    const windows = openWindowsForDate({
      dateKey: MONDAY,
      timezone: TZ,
      workingHours: weekly,
      dateOverrides: [{ onDate: MONDAY, startMin: 600, endMin: 720 }],
      closures: [{ onDate: MONDAY, startMin: null, endMin: null }],
    });
    expect(windows).toEqual([]);
  });

  it('ignores rules belonging to another date', () => {
    const windows = openWindowsForDate({
      dateKey: MONDAY,
      timezone: TZ,
      workingHours: weekly,
      closures: [{ onDate: SUNDAY, startMin: null, endMin: null }],
      dateOverrides: [{ onDate: SUNDAY, startMin: 0, endMin: 60 }],
    });
    expect(windows).toHaveLength(2);
  });
});

describe('isOutsideOpeningHours', () => {
  const windows = [
    { startMin: 540, endMin: 780 },
    { startMin: 840, endMin: 1020 },
  ];

  it('is inside when fully contained in one window', () => {
    expect(isOutsideOpeningHours(600, 660, windows)).toBe(false);
  });

  it('is outside before opening — the 07:30 booking the predecessor hid', () => {
    expect(isOutsideOpeningHours(450, 510, windows)).toBe(true);
  });

  it('is outside when it runs past closing', () => {
    expect(isOutsideOpeningHours(960, 1080, windows)).toBe(true);
  });

  it('is outside when it straddles the lunch break', () => {
    expect(isOutsideOpeningHours(750, 870, windows)).toBe(true);
  });

  it('is outside on a closed day, where there are no windows at all', () => {
    expect(isOutsideOpeningHours(600, 660, [])).toBe(true);
  });

  it('treats two adjacent rows as continuous', () => {
    const adjacent = [
      { startMin: 540, endMin: 780 },
      { startMin: 780, endMin: 1020 },
    ];
    expect(mergeWindows(adjacent)).toEqual([{ startMin: 540, endMin: 1020 }]);
    expect(isOutsideOpeningHours(700, 900, adjacent)).toBe(false);
  });
});
