/**
 * Availability and slot generation.
 *
 * Pure functions over plain data — no database, no clock of its own. Everything that
 * varies (the business's timezone and policy, its hours, its closures, what is already
 * booked, and what "now" is) arrives as an argument, so every edge case is reachable
 * from a test.
 */
import {
  addDays,
  dateKeysBetween,
  instantToDateKey,
  localToInstant,
  weekdayOf,
  type DateKey,
  type Minutes,
} from './time';

/** One row of the weekly template. Breaks are the gaps between rows on the same weekday. */
export type WorkingHour = { weekday: number; startMin: Minutes; endMin: Minutes };

/** A closed day, or a closed part of one. Null start/end means the whole day. */
export type Closure = { onDate: DateKey; startMin: Minutes | null; endMin: Minutes | null };

/** An interval already occupied, buffers included. Mirrors bookings.blocks_from/until. */
export type BusyInterval = { from: Date; until: Date };

export type SlotPolicy = {
  timezone: string;
  slotGranularityMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
};

export type ServiceShape = {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
};

export type AvailabilityInput = {
  from: DateKey;
  to: DateKey;
  now: Date;
  policy: SlotPolicy;
  service: ServiceShape;
  workingHours: WorkingHour[];
  closures: Closure[];
  busy: BusyInterval[];
};

/**
 * Why four states rather than "has slots / has none":
 *
 *  closed         — the business is not open: no hours for this weekday, or a closure
 *                   covers the whole working window.
 *  full           — open, but everything bookable is taken.
 *  too_soon       — open and free, but every slot falls inside the minimum-notice window.
 *  beyond_horizon — the business is not taking bookings this far ahead yet.
 *  open           — at least one bookable slot.
 *
 * Collapsing these is a real bug, not a nicety. A day closed for part of the afternoon
 * showed as "full" in the predecessor app and invited customers onto a waitlist for a
 * day the owner had deliberately shut. Every state must also lead somewhere in the UI —
 * a day that renders as a dead, silent tap was reported three times by three reviewers.
 */
export type DayState = 'open' | 'full' | 'closed' | 'too_soon' | 'beyond_horizon';

export type DayAvailability = {
  date: DateKey;
  state: DayState;
  slots: Date[];
};

type Window = { startMin: Minutes; endMin: Minutes };

/** The open windows for a date, after subtracting that date's closures. */
function openWindows(
  dateKey: DateKey,
  policy: SlotPolicy,
  workingHours: WorkingHour[],
  closures: Closure[],
): Window[] {
  const weekday = weekdayOf(dateKey, policy.timezone);

  let windows: Window[] = workingHours
    .filter((wh) => wh.weekday === weekday)
    .map((wh) => ({ startMin: wh.startMin, endMin: wh.endMin }))
    .sort((a, b) => a.startMin - b.startMin);

  for (const closure of closures) {
    if (closure.onDate !== dateKey) continue;

    // A whole-day closure removes everything.
    if (closure.startMin === null || closure.endMin === null) return [];

    const cut: Window[] = [];
    for (const w of windows) {
      if (closure.endMin <= w.startMin || closure.startMin >= w.endMin) {
        cut.push(w); // no overlap
        continue;
      }
      if (closure.startMin > w.startMin) {
        cut.push({ startMin: w.startMin, endMin: closure.startMin });
      }
      if (closure.endMin < w.endMin) {
        cut.push({ startMin: closure.endMin, endMin: w.endMin });
      }
    }
    windows = cut;
  }

  return windows.filter((w) => w.endMin > w.startMin);
}

function overlaps(aFrom: Date, aUntil: Date, bFrom: Date, bUntil: Date): boolean {
  return aFrom.getTime() < bUntil.getTime() && aUntil.getTime() > bFrom.getTime();
}

export function generateAvailability(inputs: AvailabilityInput): DayAvailability[] {
  const { from, to, now, policy, service, workingHours, closures, busy } = inputs;

  if (policy.slotGranularityMin <= 0) {
    throw new Error('slotGranularityMin must be positive');
  }
  if (service.durationMin <= 0) {
    throw new Error('durationMin must be positive');
  }

  const earliestStart = new Date(now.getTime() + policy.minNoticeMin * 60_000);
  const lastBookableDay = addDays(
    instantToDateKey(now, policy.timezone),
    policy.maxAdvanceDays,
  );

  return dateKeysBetween(from, to).map((dateKey): DayAvailability => {
    // Not "closed": the business may well be open, it just is not taking bookings this
    // far out yet. The customer needs to be told which of the two it is.
    if (dateKey > lastBookableDay) {
      return { date: dateKey, state: 'beyond_horizon', slots: [] };
    }

    const windows = openWindows(dateKey, policy, workingHours, closures);
    if (windows.length === 0) {
      return { date: dateKey, state: 'closed', slots: [] };
    }

    const slots: Date[] = [];
    let withheldForNotice = false;

    for (const window of windows) {
      for (
        let startMin = window.startMin;
        startMin + service.durationMin <= window.endMin;
        startMin += policy.slotGranularityMin
      ) {
        let start: Date;
        try {
          start = localToInstant(dateKey, startMin, policy.timezone);
        } catch {
          // A wall-clock time erased by a spring-forward transition is simply not offered.
          continue;
        }
        const end = new Date(start.getTime() + service.durationMin * 60_000);

        if (start.getTime() < earliestStart.getTime()) {
          withheldForNotice = true;
          continue;
        }

        // The candidate occupies its own buffers too, not just the appointment.
        const candidateFrom = new Date(start.getTime() - service.bufferBeforeMin * 60_000);
        const candidateUntil = new Date(end.getTime() + service.bufferAfterMin * 60_000);

        const clashes = busy.some((b) => overlaps(candidateFrom, candidateUntil, b.from, b.until));
        if (clashes) continue;

        slots.push(start);
      }
    }

    if (slots.length > 0) return { date: dateKey, state: 'open', slots };
    return { date: dateKey, state: withheldForNotice ? 'too_soon' : 'full', slots: [] };
  });
}
