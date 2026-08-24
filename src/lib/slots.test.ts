import { describe, expect, it } from 'vitest';
import { generateAvailability, type AvailabilityInput } from './slots';
import { instantToMinutes, localToInstant } from './time';

const TZ = 'Asia/Jerusalem';

/** 2026-06-15 is a Monday; 2026-06-19 a Friday; 2026-06-20 a Saturday. */
const MONDAY = '2026-06-15';

const at = (dateKey: string, minutes: number) => localToInstant(dateKey, minutes, TZ);

/**
 * Well before every fixture day — including the March DST transition — so a slot is
 * never withheld for minimum notice unless a test sets `now` itself.
 */
const EARLY = at('2026-01-05', 8 * 60);

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    from: MONDAY,
    to: MONDAY,
    now: EARLY,
    policy: {
      timezone: TZ,
      slotGranularityMin: 60,
      minNoticeMin: 0,
      maxAdvanceDays: 365,
    },
    service: { durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0 },
    // Monday 09:00–17:00.
    workingHours: [{ weekday: 1, startMin: 9 * 60, endMin: 17 * 60 }],
    closures: [],
    busy: [],
    ...overrides,
  };
}

/** Slot start times as minutes-from-midnight, for readable assertions. */
const slotMinutes = (day: { slots: Date[] }) => day.slots.map((s) => instantToMinutes(s, TZ));

describe('generateAvailability — core slot generation', () => {
  it('walks the open window at the granularity step', () => {
    const [day] = generateAvailability(input());
    expect(day.date).toBe(MONDAY);
    expect(day.state).toBe('open');
    expect(slotMinutes(day)).toEqual([540, 600, 660, 720, 780, 840, 900, 960]);
  });

  it('includes the slot that ends exactly at closing time', () => {
    const [day] = generateAvailability(input());
    // 16:00 + 60min = 17:00, the closing minute. It fits, so it is bookable.
    expect(slotMinutes(day)).toContain(16 * 60);
  });

  it('excludes a slot whose service would overrun closing time', () => {
    const [day] = generateAvailability(
      input({
        policy: { timezone: TZ, slotGranularityMin: 30, minNoticeMin: 0, maxAdvanceDays: 365 },
        service: { durationMin: 90, bufferBeforeMin: 0, bufferAfterMin: 0 },
      }),
    );
    // Last 90-minute service that fits before 17:00 starts at 15:30.
    expect(slotMinutes(day).at(-1)).toBe(15 * 60 + 30);
    expect(slotMinutes(day)).not.toContain(16 * 60);
  });

  it('treats a gap between two working-hours rows as a break', () => {
    const [day] = generateAvailability(
      input({
        workingHours: [
          { weekday: 1, startMin: 9 * 60, endMin: 13 * 60 },
          { weekday: 1, startMin: 14 * 60, endMin: 17 * 60 },
        ],
      }),
    );
    expect(slotMinutes(day)).toEqual([540, 600, 660, 720, 840, 900, 960]);
    expect(slotMinutes(day)).not.toContain(13 * 60);
  });

  it('does not let a service straddle a break', () => {
    const [day] = generateAvailability(
      input({
        policy: { timezone: TZ, slotGranularityMin: 30, minNoticeMin: 0, maxAdvanceDays: 365 },
        service: { durationMin: 90, bufferBeforeMin: 0, bufferAfterMin: 0 },
        workingHours: [
          { weekday: 1, startMin: 9 * 60, endMin: 13 * 60 },
          { weekday: 1, startMin: 14 * 60, endMin: 17 * 60 },
        ],
      }),
    );
    // 12:00 would run to 13:30, across the break. 11:30 (→13:00) is the last that fits.
    expect(slotMinutes(day)).toContain(11 * 60 + 30);
    expect(slotMinutes(day)).not.toContain(12 * 60);
  });
});

describe('generateAvailability — existing bookings', () => {
  it('removes a slot taken by an existing booking', () => {
    const [day] = generateAvailability(
      input({
        busy: [{ from: at(MONDAY, 11 * 60), until: at(MONDAY, 12 * 60) }],
      }),
    );
    expect(slotMinutes(day)).not.toContain(11 * 60);
    expect(slotMinutes(day)).toContain(10 * 60);
    expect(slotMinutes(day)).toContain(12 * 60);
  });

  it('respects the buffer around an existing booking', () => {
    // The busy interval already carries its own buffers, as stored on the booking row.
    const [day] = generateAvailability(
      input({
        policy: { timezone: TZ, slotGranularityMin: 30, minNoticeMin: 0, maxAdvanceDays: 365 },
        busy: [{ from: at(MONDAY, 11 * 60 - 15), until: at(MONDAY, 12 * 60 + 15) }],
      }),
    );
    expect(slotMinutes(day)).not.toContain(10 * 60 + 30); // 10:30–11:30 overlaps the buffer
    expect(slotMinutes(day)).not.toContain(12 * 60); //      12:00 starts inside the buffer
    expect(slotMinutes(day)).toContain(12 * 60 + 30);
  });

  it('applies the new service’s own buffers when testing for a clash', () => {
    const [day] = generateAvailability(
      input({
        policy: { timezone: TZ, slotGranularityMin: 30, minNoticeMin: 0, maxAdvanceDays: 365 },
        service: { durationMin: 60, bufferBeforeMin: 30, bufferAfterMin: 0 },
        busy: [{ from: at(MONDAY, 10 * 60), until: at(MONDAY, 11 * 60) }],
      }),
    );
    // An 11:00 start needs the half hour before it free, and that half hour is booked.
    expect(slotMinutes(day)).not.toContain(11 * 60);
    expect(slotMinutes(day)).toContain(11 * 60 + 30);
  });

  it('lets a booking abut another exactly, with no overlap', () => {
    const [day] = generateAvailability(
      input({ busy: [{ from: at(MONDAY, 9 * 60), until: at(MONDAY, 10 * 60) }] }),
    );
    expect(slotMinutes(day)).not.toContain(9 * 60);
    expect(slotMinutes(day)).toContain(10 * 60);
  });
});

describe('generateAvailability — day states', () => {
  it('reports a weekday with no working hours as closed', () => {
    const saturday = '2026-06-20';
    const [day] = generateAvailability(input({ from: saturday, to: saturday }));
    expect(day.state).toBe('closed');
    expect(day.slots).toEqual([]);
  });

  it('reports a whole-day closure as closed', () => {
    const [day] = generateAvailability(
      input({ closures: [{ onDate: MONDAY, startMin: null, endMin: null }] }),
    );
    expect(day.state).toBe('closed');
  });

  it('reports a day the owner closed for its whole working window as closed, not full', () => {
    const [day] = generateAvailability(
      input({ closures: [{ onDate: MONDAY, startMin: 9 * 60, endMin: 17 * 60 }] }),
    );
    expect(day.state).toBe('closed');
  });

  it('keeps a partially closed day open and drops only the closed hours', () => {
    const [day] = generateAvailability(
      input({ closures: [{ onDate: MONDAY, startMin: 12 * 60, endMin: 14 * 60 }] }),
    );
    expect(day.state).toBe('open');
    expect(slotMinutes(day)).toEqual([540, 600, 660, 840, 900, 960]);
  });

  it('ignores a closure belonging to another date', () => {
    const [day] = generateAvailability(
      input({ closures: [{ onDate: '2026-06-16', startMin: null, endMin: null }] }),
    );
    expect(day.state).toBe('open');
  });

  it('reports a day with no room left as full, distinct from closed', () => {
    const [day] = generateAvailability(
      input({ busy: [{ from: at(MONDAY, 9 * 60), until: at(MONDAY, 17 * 60) }] }),
    );
    expect(day.state).toBe('full');
    expect(day.slots).toEqual([]);
  });
});

describe('generateAvailability — minimum notice and booking horizon', () => {
  it('hides slots inside the minimum-notice window', () => {
    const [day] = generateAvailability(
      input({
        now: at(MONDAY, 9 * 60),
        policy: { timezone: TZ, slotGranularityMin: 60, minNoticeMin: 120, maxAdvanceDays: 365 },
      }),
    );
    // 09:00 + 2h notice = 11:00 is the earliest bookable start.
    expect(slotMinutes(day)).toEqual([660, 720, 780, 840, 900, 960]);
  });

  it('reports a day blocked only by notice as too_soon, not full', () => {
    const [day] = generateAvailability(
      input({
        now: at(MONDAY, 16 * 60 + 30),
        policy: { timezone: TZ, slotGranularityMin: 60, minNoticeMin: 120, maxAdvanceDays: 365 },
      }),
    );
    expect(day.state).toBe('too_soon');
    expect(day.slots).toEqual([]);
  });

  it('reports a date past the booking horizon distinctly from a closed day', () => {
    const far = '2026-09-14'; // a Monday, well beyond a 30-day horizon
    const [day] = generateAvailability(
      input({
        from: far,
        to: far,
        now: at('2026-06-15', 9 * 60),
        policy: { timezone: TZ, slotGranularityMin: 60, minNoticeMin: 0, maxAdvanceDays: 30 },
      }),
    );
    expect(day.state).toBe('beyond_horizon');
    expect(day.slots).toEqual([]);
  });

  it('still offers the last day inside the horizon', () => {
    const [day] = generateAvailability(
      input({
        from: '2026-07-15',
        to: '2026-07-15', // a Wednesday, 30 days after 2026-06-15
        now: at('2026-06-15', 9 * 60),
        policy: { timezone: TZ, slotGranularityMin: 60, minNoticeMin: 0, maxAdvanceDays: 30 },
        workingHours: [{ weekday: 3, startMin: 9 * 60, endMin: 17 * 60 }],
      }),
    );
    expect(day.state).toBe('open');
  });
});

describe('generateAvailability — awkward real days', () => {
  it('generates wall-clock-correct slots on the 23-hour spring-forward day', () => {
    const dstDay = '2026-03-27'; // a Friday
    const [day] = generateAvailability(
      input({
        from: dstDay,
        to: dstDay,
        workingHours: [{ weekday: 5, startMin: 9 * 60, endMin: 13 * 60 }],
      }),
    );
    expect(day.state).toBe('open');
    expect(slotMinutes(day)).toEqual([540, 600, 660, 720]);
  });

  it('generates wall-clock-correct slots on the 25-hour fall-back day', () => {
    const dstDay = '2026-10-25'; // a Sunday
    const [day] = generateAvailability(
      input({
        from: dstDay,
        to: dstDay,
        workingHours: [{ weekday: 0, startMin: 9 * 60, endMin: 13 * 60 }],
      }),
    );
    expect(day.state).toBe('open');
    expect(slotMinutes(day)).toEqual([540, 600, 660, 720]);
  });

  it('skips a wall-clock time the spring-forward transition erases', () => {
    const dstDay = '2026-03-27';
    const [day] = generateAvailability(
      input({
        from: dstDay,
        to: dstDay,
        policy: { timezone: TZ, slotGranularityMin: 30, minNoticeMin: 0, maxAdvanceDays: 365 },
        service: { durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0 },
        // Overnight hours spanning the 02:00 gap.
        workingHours: [{ weekday: 5, startMin: 1 * 60, endMin: 4 * 60 }],
      }),
    );
    // 02:00 and 02:30 do not exist that morning; everything else does.
    expect(slotMinutes(day)).toEqual([60, 90, 180, 210]);
  });

  it('handles a short Friday', () => {
    const friday = '2026-06-19';
    const [day] = generateAvailability(
      input({
        from: friday,
        to: friday,
        workingHours: [{ weekday: 5, startMin: 9 * 60, endMin: 13 * 60 }],
      }),
    );
    expect(slotMinutes(day)).toEqual([540, 600, 660, 720]);
  });

  it('covers a multi-day range, one entry per day, in order', () => {
    const days = generateAvailability(
      input({
        from: '2026-06-15',
        to: '2026-06-21',
        workingHours: [
          { weekday: 1, startMin: 9 * 60, endMin: 17 * 60 },
          { weekday: 5, startMin: 9 * 60, endMin: 13 * 60 },
        ],
      }),
    );
    expect(days.map((d) => d.date)).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
      '2026-06-20',
      '2026-06-21',
    ]);
    expect(days.map((d) => d.state)).toEqual([
      'open',
      'closed',
      'closed',
      'closed',
      'open',
      'closed',
      'closed',
    ]);
  });
});

describe('generateAvailability — the midnight boundary', () => {
  it('offers a slot that runs to the end of the day', () => {
    const [day] = generateAvailability(
      input({
        workingHours: [{ weekday: 1, startMin: 22 * 60, endMin: 1440 }],
      }),
    );
    expect(slotMinutes(day)).toEqual([22 * 60, 23 * 60]);
  });

  /**
   * Working hours cannot cross midnight: a window is minutes within one local day, and
   * end must exceed start. A business open 20:00–02:00 expresses that as two rows on
   * consecutive weekdays, and a single service cannot straddle the boundary.
   *
   * Pinned deliberately. The predecessor app allowed appointments across midnight and
   * they rendered clipped *outside* the visible timeline — invisible on both the day and
   * week views, which is worse than not offering them.
   */
  it('does not let a service run past the end of the day', () => {
    const [day] = generateAvailability(
      input({
        policy: { timezone: TZ, slotGranularityMin: 30, minNoticeMin: 0, maxAdvanceDays: 365 },
        service: { durationMin: 90, bufferBeforeMin: 0, bufferAfterMin: 0 },
        workingHours: [{ weekday: 1, startMin: 22 * 60, endMin: 1440 }],
      }),
    );
    expect(slotMinutes(day)).toEqual([22 * 60, 22 * 60 + 30]);
  });

  it('treats an overnight business as two separate days', () => {
    const days = generateAvailability(
      input({
        from: '2026-06-15',
        to: '2026-06-16',
        workingHours: [
          { weekday: 1, startMin: 22 * 60, endMin: 1440 }, // Monday evening
          { weekday: 2, startMin: 0, endMin: 2 * 60 }, //     into Tuesday morning
        ],
      }),
    );
    expect(slotMinutes(days[0]!)).toEqual([22 * 60, 23 * 60]);
    expect(slotMinutes(days[1]!)).toEqual([0, 60]);
  });
});

describe('generateAvailability — per-date overrides', () => {
  it('opens a normally-closed day when the date is overridden', () => {
    const saturday = '2026-06-20';
    const [day] = generateAvailability(
      input({
        from: saturday,
        to: saturday,
        dateOverrides: [{ onDate: saturday, startMin: 10 * 60, endMin: 14 * 60 }],
      }),
    );
    expect(day.state).toBe('open');
    expect(slotMinutes(day)).toEqual([600, 660, 720, 780]);
  });

  it('replaces the weekly template rather than adding to it', () => {
    const [day] = generateAvailability(
      input({ dateOverrides: [{ onDate: MONDAY, startMin: 14 * 60, endMin: 17 * 60 }] }),
    );
    // The weekly Monday is 09:00–17:00; the override is the whole truth for this date.
    expect(slotMinutes(day)).toEqual([840, 900, 960]);
  });

  it('supports several override rows on one date, so a break can be overridden too', () => {
    const [day] = generateAvailability(
      input({
        dateOverrides: [
          { onDate: MONDAY, startMin: 9 * 60, endMin: 11 * 60 },
          { onDate: MONDAY, startMin: 15 * 60, endMin: 17 * 60 },
        ],
      }),
    );
    expect(slotMinutes(day)).toEqual([540, 600, 900, 960]);
  });

  it('leaves other dates on the weekly template', () => {
    const days = generateAvailability(
      input({
        from: '2026-06-15',
        to: '2026-06-16',
        workingHours: [
          { weekday: 1, startMin: 9 * 60, endMin: 17 * 60 },
          { weekday: 2, startMin: 9 * 60, endMin: 17 * 60 },
        ],
        dateOverrides: [{ onDate: '2026-06-16', startMin: 9 * 60, endMin: 11 * 60 }],
      }),
    );
    expect(slotMinutes(days[0]!)).toHaveLength(8); // untouched Monday
    expect(slotMinutes(days[1]!)).toEqual([540, 600]);
  });

  it('still lets a closure shut an overridden day', () => {
    const saturday = '2026-06-20';
    const [day] = generateAvailability(
      input({
        from: saturday,
        to: saturday,
        dateOverrides: [{ onDate: saturday, startMin: 10 * 60, endMin: 14 * 60 }],
        closures: [{ onDate: saturday, startMin: null, endMin: null }],
      }),
    );
    expect(day.state).toBe('closed');
  });
});
