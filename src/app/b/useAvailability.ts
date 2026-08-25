'use client';

/**
 * Month-at-a-time availability loading for the calendar.
 *
 * The rule this hook exists to keep is #1 on this project's list of shipped bugs: a slot
 * fetch with no `.catch()` left a customer on "loading hours…" forever. Every network
 * call here goes through `useAsyncAction`, whose `pending` is cleared in a `finally`, so
 * a stuck spinner is not expressible.
 *
 * The second, subtler trap is the double-submit guard inside `useAsyncAction`: a second
 * `run()` while one is in flight is *ignored*. Flick three months forward quickly and the
 * later months' fetches would simply never happen — the calendar would sit empty with no
 * spinner and no error, which is the same dead end wearing a different hat. That is why
 * the fetch is expressed as an effect that depends on `pending`: when the in-flight call
 * settles, the effect re-runs and picks up whatever month is on screen by then.
 *
 * A month that has failed is recorded and *not* retried automatically. Auto-retrying a
 * failing call inside an effect that depends on its own result is an infinite loop; the
 * customer gets an error with a button instead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAsyncAction } from '@/app/components';
import type { Lang } from '@/lib/i18n';
import { firstOfMonth, lastOfMonth, monthKeyOf, shiftMonths } from './lib/format';
import type { AvailabilityPayload, DayDto } from './lib/types';

/** Resolves, or throws with a display-ready message. Unwrapping the action result is the caller's job. */
export type AvailabilityFetcher = (from: string, to: string) => Promise<AvailabilityPayload>;

export type UseAvailabilityOptions = {
  fetcher: AvailabilityFetcher;
  timezone: string;
  /** Business-local today, resolved on the server. */
  today: string;
  /** Last bookable day, resolved on the server. */
  horizon: string;
  lang: Lang;
  /** False while there is nothing to load yet (no service chosen). */
  enabled: boolean;
  /**
   * Changing this throws the cache away — different service, different durations,
   * different slots. Stale slots from the previous service are worse than a spinner.
   */
  resetKey: string;
  /** Month to open on. Defaults to the month containing `today`. */
  initialMonth?: string;
};

export type UseAvailabilityResult = {
  monthAnchor: string;
  monthKey: string;
  /** Days of the current month, keyed by date. Empty while loading. */
  days: Record<string, DayDto>;
  loading: boolean;
  /** Localised, display-ready. Null when the current month loaded fine. */
  error: string | null;
  retry: () => void;
  goToMonth: (dateKey: string) => void;
  stepMonth: (months: number) => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  /** True once the current month's data is present. */
  isMonthLoaded: boolean;
  /** Look a day up across every month loaded so far. */
  dayFor: (dateKey: string) => DayDto | undefined;
};

type MonthCache = Record<string, Record<string, DayDto>>;

export function useAvailability(options: UseAvailabilityOptions): UseAvailabilityResult {
  const { fetcher, timezone, today, horizon, lang, enabled, resetKey, initialMonth } = options;

  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(initialMonth ?? today));
  const [cache, setCache] = useState<MonthCache>({});
  const [failures, setFailures] = useState<Record<string, string>>({});

  const monthKey = monthKeyOf(monthAnchor);
  const todayMonth = monthKeyOf(today);
  const horizonMonth = monthKeyOf(horizon);

  // A different service means different durations and different slots; nothing cached
  // for the previous one is still true.
  //
  // Adjusted during render rather than in an effect on purpose: an effect would let one
  // frame render with the new service and the *old* service's slots still on screen —
  // 45-minute times offered for a 20-minute cut, which a customer would happily tap.
  const [activeReset, setActiveReset] = useState(resetKey);
  if (activeReset !== resetKey) {
    setActiveReset(resetKey);
    setCache({});
    setFailures({});
  }

  const { run, pending } = useAsyncAction(
    async (key: string, from: string, to: string) => {
      try {
        const payload = await fetcher(from, to);
        const byDate: Record<string, DayDto> = {};
        for (const day of payload.days) byDate[day.date] = day;
        setCache((prev) => ({ ...prev, [key]: byDate }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFailures((prev) => ({ ...prev, [key]: message }));
        // Rethrown so `useAsyncAction` still settles and localises it; the per-month
        // record above is what the calendar actually renders.
        throw err;
      }
    },
    { lang },
  );

  useEffect(() => {
    if (!enabled) return;
    if (cache[monthKey]) return;
    if (failures[monthKey]) return;
    // A call is already in flight: `useAsyncAction` would ignore a second one, so wait
    // for `pending` to flip and let this effect fire again.
    if (pending) return;

    void run(monthKey, firstOfMonth(monthAnchor), lastOfMonth(monthAnchor, timezone));
  }, [enabled, monthKey, monthAnchor, timezone, cache, failures, pending, run]);

  const retry = useCallback(() => {
    setFailures((prev) => {
      const next = { ...prev };
      delete next[monthKey];
      return next;
    });
  }, [monthKey]);

  const goToMonth = useCallback((dateKey: string) => {
    setMonthAnchor(firstOfMonth(dateKey));
  }, []);

  const stepMonth = useCallback(
    (months: number) => {
      setMonthAnchor((current) => shiftMonths(current, months, timezone));
    },
    [timezone],
  );

  const dayFor = useCallback(
    (dateKey: string) => cache[monthKeyOf(dateKey)]?.[dateKey],
    [cache],
  );

  const days = useMemo(() => cache[monthKey] ?? {}, [cache, monthKey]);
  const isMonthLoaded = cache[monthKey] !== undefined;

  return {
    monthAnchor,
    monthKey,
    days,
    loading: enabled && !isMonthLoaded && !failures[monthKey],
    error: failures[monthKey] ?? null,
    retry,
    goToMonth,
    stepMonth,
    canGoPrev: monthKey > todayMonth,
    canGoNext: monthKey < horizonMonth,
    isMonthLoaded,
    dayFor,
  };
}
