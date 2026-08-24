/**
 * The time module is the foundation every slot calculation stands on, so its tests are
 * deliberately paranoid about the two failures that actually happen in booking systems:
 * computing a local date in the wrong timezone, and losing an hour at a DST transition.
 *
 * Fixtures use real Israel DST transitions in 2026, verified against the IANA database:
 *   2026-03-27 — clocks go forward, a 23-hour day
 *   2026-10-25 — clocks go back,    a 25-hour day
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateKeysBetween,
  instantToDateKey,
  instantToMinutes,
  localToInstant,
  weekdayOf,
} from './time';

const TZ = 'Asia/Jerusalem';

describe('localToInstant / instantToMinutes', () => {
  it('round-trips a wall-clock time on an ordinary day', () => {
    const instant = localToInstant('2026-06-15', 9 * 60 + 30, TZ);
    expect(instantToMinutes(instant, TZ)).toBe(9 * 60 + 30);
    expect(instantToDateKey(instant, TZ)).toBe('2026-06-15');
  });

  it('keeps midnight and end-of-day distinct', () => {
    expect(instantToMinutes(localToInstant('2026-06-15', 0, TZ), TZ)).toBe(0);
    expect(instantToMinutes(localToInstant('2026-06-15', 1439, TZ), TZ)).toBe(1439);
  });

  it('resolves the same wall clock differently in different timezones', () => {
    const jerusalem = localToInstant('2026-06-15', 600, TZ);
    const london = localToInstant('2026-06-15', 600, 'Europe/London');
    expect(jerusalem.getTime()).not.toBe(london.getTime());
  });

  /**
   * The bug this module exists to prevent.
   *
   * Building a local time by adding minutes to local midnight adds *absolute* duration,
   * so on a 23-hour day every appointment after the transition lands an hour late. The
   * predecessor project shipped exactly this and would have shifted every single booking
   * at the October change. Setting the wall-clock fields instead is timezone-correct.
   */
  it('places a morning appointment correctly on the 23-hour spring-forward day', () => {
    const instant = localToInstant('2026-03-27', 10 * 60, TZ);
    expect(instantToMinutes(instant, TZ)).toBe(10 * 60);
    expect(instantToDateKey(instant, TZ)).toBe('2026-03-27');

    // Only 9 real hours have elapsed since local midnight, because an hour vanished.
    const midnight = localToInstant('2026-03-27', 0, TZ);
    const elapsedHours = (instant.getTime() - midnight.getTime()) / 3_600_000;
    expect(elapsedHours).toBe(9);
  });

  it('places a morning appointment correctly on the 25-hour fall-back day', () => {
    const instant = localToInstant('2026-10-25', 10 * 60, TZ);
    expect(instantToMinutes(instant, TZ)).toBe(10 * 60);
    expect(instantToDateKey(instant, TZ)).toBe('2026-10-25');

    const midnight = localToInstant('2026-10-25', 0, TZ);
    const elapsedHours = (instant.getTime() - midnight.getTime()) / 3_600_000;
    expect(elapsedHours).toBe(11);
  });

  it('rejects a wall-clock time that does not exist rather than silently sliding it', () => {
    // 02:30 never happens on the spring-forward morning.
    expect(() => localToInstant('2026-03-27', 2 * 60 + 30, TZ)).toThrow(/does not exist/i);
  });
});

describe('instantToDateKey', () => {
  it('uses the business timezone, not UTC', () => {
    // 23:30 in Jerusalem is still the previous day in UTC.
    const instant = localToInstant('2026-06-15', 23 * 60 + 30, TZ);
    expect(instantToDateKey(instant, TZ)).toBe('2026-06-15');
    expect(instantToDateKey(instant, 'UTC')).toBe('2026-06-15');

    // 00:30 in Jerusalem is the previous day in UTC — the case that breaks month grids
    // rendered from the browser's clock.
    const justAfterMidnight = localToInstant('2026-06-15', 30, TZ);
    expect(instantToDateKey(justAfterMidnight, TZ)).toBe('2026-06-15');
    expect(instantToDateKey(justAfterMidnight, 'UTC')).toBe('2026-06-14');
  });
});

describe('weekdayOf', () => {
  it('numbers the week from Sunday', () => {
    expect(weekdayOf('2026-06-14', TZ)).toBe(0); // Sunday
    expect(weekdayOf('2026-06-19', TZ)).toBe(5); // Friday
    expect(weekdayOf('2026-06-20', TZ)).toBe(6); // Saturday
  });
});

describe('date key arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds a day across a DST transition without losing one', () => {
    expect(addDays('2026-03-27', 1)).toBe('2026-03-28');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('lists date keys inclusively', () => {
    expect(dateKeysBetween('2026-06-15', '2026-06-18')).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
    ]);
  });

  it('returns a single key when the range is one day', () => {
    expect(dateKeysBetween('2026-06-15', '2026-06-15')).toEqual(['2026-06-15']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(dateKeysBetween('2026-06-18', '2026-06-15')).toEqual([]);
  });

  it('rejects a date that does not exist', () => {
    expect(() => weekdayOf('2026-02-31', TZ)).toThrow(/invalid/i);
  });
});
