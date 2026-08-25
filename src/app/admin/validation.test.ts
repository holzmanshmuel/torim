/**
 * The cross-field range check, and the translation of the database's own refusals.
 *
 * The first `describe` is the regression test for the bug the whole file exists for: a
 * closure that ended before it started, persisted by two independent time pickers with
 * no cross-check, blocking zero minutes while reading as valid.
 */
import { describe, expect, it } from 'vitest';
import {
  CALLING_CODE_SHAPE,
  CURRENCY_SHAPE,
  SLUG_SHAPE,
  boundedInt,
  dbErrorCode,
  isDateKey,
  isTimezone,
  optionalText,
  overlapsExisting,
  parseHhMm,
  parseTimeRange,
  requiredText,
  slugify,
} from './validation';

describe('parseTimeRange', () => {
  it('accepts a real range', () => {
    expect(parseTimeRange('09:00', '17:00')).toEqual({
      ok: true,
      value: { startMin: 540, endMin: 1020 },
    });
  });

  it('rejects an end BEFORE the start', () => {
    expect(parseTimeRange('12:00', '10:00')).toEqual({
      ok: false,
      field: 'end',
      code: 'end_not_after_start',
    });
  });

  it('rejects an end EQUAL to the start — zero minutes blocks nothing', () => {
    expect(parseTimeRange('10:00', '10:00')).toEqual({
      ok: false,
      field: 'end',
      code: 'end_not_after_start',
    });
  });

  it('names the field that is wrong, and uses caller-supplied field names', () => {
    const result = parseTimeRange('', '10:00', { start: 'closureStart', end: 'closureEnd' });
    expect(result).toEqual({ ok: false, field: 'closureStart', code: 'start_required' });

    const missingEnd = parseTimeRange('09:00', '', { start: 'a', end: 'b' });
    expect(missingEnd).toEqual({ ok: false, field: 'b', code: 'end_required' });
  });

  it('rejects text that is not a time', () => {
    expect(parseTimeRange('nine', '17:00')).toMatchObject({ code: 'time_shape', field: 'start' });
    expect(parseTimeRange('09:00', '25:00')).toMatchObject({ code: 'time_shape', field: 'end' });
    expect(parseTimeRange('09:00', '17:75')).toMatchObject({ code: 'time_shape', field: 'end' });
  });

  it('allows 24:00 as an end, because the schema does', () => {
    expect(parseTimeRange('20:00', '24:00')).toEqual({
      ok: true,
      value: { startMin: 1200, endMin: 1440 },
    });
    // …but never as a start.
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('24:00', true)).toBe(1440);
  });

  it('tolerates the seconds an <input type="time"> sometimes emits', () => {
    expect(parseHhMm('09:30:00')).toBe(570);
  });
});

describe('overlapsExisting', () => {
  const existing = [
    { startMin: 540, endMin: 780 },
    { startMin: 840, endMin: 1080 },
  ];

  it('spots an overlap', () => {
    expect(overlapsExisting({ startMin: 600, endMin: 900 }, existing)).toBe(true);
    expect(overlapsExisting({ startMin: 500, endMin: 600 }, existing)).toBe(true);
  });

  it('allows a break: two rows that merely touch do not overlap', () => {
    expect(overlapsExisting({ startMin: 780, endMin: 840 }, existing)).toBe(false);
    expect(overlapsExisting({ startMin: 1080, endMin: 1200 }, existing)).toBe(false);
  });
});

describe('shapes', () => {
  it('accepts only a real calendar day', () => {
    expect(isDateKey('2026-06-15')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('15/06/2026')).toBe(false);
    expect(isDateKey('')).toBe(false);
  });

  it('checks a timezone against Intl rather than a hardcoded list', () => {
    expect(isTimezone('Asia/Jerusalem')).toBe(true);
    expect(isTimezone('UTC')).toBe(true);
    expect(isTimezone('Middle/Earth')).toBe(false);
    expect(isTimezone('')).toBe(false);
  });

  it('mirrors the database CHECK on slug, currency and calling code', () => {
    expect(SLUG_SHAPE.test('bella-salon')).toBe(true);
    expect(SLUG_SHAPE.test('a')).toBe(true);
    expect(SLUG_SHAPE.test('-bad')).toBe(false);
    expect(SLUG_SHAPE.test('bad-')).toBe(false);
    expect(SLUG_SHAPE.test('Bella')).toBe(false);
    expect(SLUG_SHAPE.test('bella salon')).toBe(false);

    expect(CURRENCY_SHAPE.test('ILS')).toBe(true);
    expect(CURRENCY_SHAPE.test('ils')).toBe(false);

    expect(CALLING_CODE_SHAPE.test('972')).toBe(true);
    expect(CALLING_CODE_SHAPE.test('0972')).toBe(false);
    expect(CALLING_CODE_SHAPE.test('+972')).toBe(false);
  });

  it('derives a usable slug from a business name', () => {
    expect(slugify('Bella Salon')).toBe('bella-salon');
    expect(slugify('  Café  Noir!! ')).toBe('cafe-noir');
    expect(slugify('סלון בלה')).toBe('');
  });
});

describe('field helpers', () => {
  it('collapses whitespace and refuses an empty required field', () => {
    expect(requiredText('  Dana   Cohen ', 'name', 'name_required')).toEqual({
      ok: true,
      value: 'Dana Cohen',
    });
    expect(requiredText('   ', 'name', 'name_required')).toEqual({
      ok: false,
      field: 'name',
      code: 'name_required',
    });
  });

  it('turns an empty optional field into null, not an empty string', () => {
    expect(optionalText('  ')).toBeNull();
    expect(optionalText(null)).toBeNull();
    expect(optionalText(' hi ')).toBe('hi');
  });

  it('bounds an integer field', () => {
    expect(boundedInt('60', 'duration', 'duration_range', 1, 1440)).toEqual({
      ok: true,
      value: 60,
    });
    expect(boundedInt('0', 'duration', 'duration_range', 1, 1440)).toMatchObject({ ok: false });
    expect(boundedInt('1441', 'duration', 'duration_range', 1, 1440)).toMatchObject({ ok: false });
    expect(boundedInt('60.5', 'duration', 'duration_range', 1, 1440)).toMatchObject({ ok: false });
    expect(boundedInt('', 'duration', 'duration_range', 1, 1440)).toMatchObject({ ok: false });
    expect(boundedInt(30, 'duration', 'duration_range', 1, 1440)).toEqual({ ok: true, value: 30 });
  });
});

describe('dbErrorCode', () => {
  it('maps the ordering CHECKs back to the same code the form uses', () => {
    for (const constraint of [
      'working_hours_ordered',
      'closures_ordered',
      'date_overrides_ordered',
    ]) {
      expect(dbErrorCode({ code: '23514', constraint })).toBe('end_not_after_start');
    }
  });

  it('maps a duplicate slug to a field message rather than a 500', () => {
    expect(dbErrorCode({ code: '23505', constraint: 'businesses_slug_key' })).toBe('slug_taken');
  });

  it('maps a service still referenced by bookings to “retire it instead”', () => {
    expect(dbErrorCode({ code: '23503', constraint: 'bookings_service_id_fkey' })).toBe('in_use');
  });

  it('still returns something actionable for an unmapped constraint', () => {
    expect(dbErrorCode({ code: '23514', constraint: 'some_future_check' })).toBe('check_failed');
    expect(dbErrorCode({ code: '23505', constraint: 'some_future_unique' })).toBe('already_exists');
  });

  it('returns null for anything that is not a database error', () => {
    expect(dbErrorCode(new Error('boom'))).toBeNull();
    expect(dbErrorCode(null)).toBeNull();
    expect(dbErrorCode('nope')).toBeNull();
    expect(dbErrorCode({ code: '08006' })).toBeNull();
  });
});
