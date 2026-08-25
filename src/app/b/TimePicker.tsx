'use client';

/**
 * Calendar + day explanation + slot grid, with its own loading and error handling.
 *
 * Shared by the booking flow and the manage page's reschedule sheet — the only thing
 * that differs between them is which Server Action fetches availability, which arrives
 * as `fetcher`.
 *
 * ── Which day is selected ─────────────────────────────────────────────────────
 * The selection is one piece of state with three modes, and everything else is derived
 * from it rather than stored. Storing "the currently selected day" separately from "how
 * we arrived at it" is what produces the classic calendar bug where the highlighted day
 * belongs to a month you are no longer looking at.
 *
 *   explicit — the customer tapped this day. Nothing overrides it.
 *   browse   — they turned the page to this month; show its first day with openings, and
 *              do not wander off to another month behind their back.
 *   hunt     — "find me the next day with openings", from mount or from the button. This
 *              one *does* walk forward through months, bounded by the booking horizon.
 *
 * The hunt is what turns a calendar full of closed Saturdays into a page that already
 * has an answer on it when it loads.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, ErrorState, Spinner, cx } from '@/app/components';
import type { Lang } from '@/lib/i18n';
import { ClockIcon } from './icons';
import {
  fill,
  formatDateFull,
  formatDateMedium,
  formatMonthTitle,
  formatTime,
  groupSlotsByPartOfDay,
  humaniseDays,
  humaniseMinutes,
  lastOfMonth,
} from './lib/format';
import type { DayDto } from './lib/types';
import { DayCalendar } from './DayCalendar';
import { useAvailability, type AvailabilityFetcher } from './useAvailability';

export type TimePickerProps = {
  lang: Lang;
  t: (key: string) => string;
  timezone: string;
  businessName: string;
  minNoticeMin: number;
  maxAdvanceDays: number;
  today: string;
  horizon: string;
  fetcher: AvailabilityFetcher;
  /** Changing this discards cached availability — e.g. a different service. */
  resetKey: string;
  enabled: boolean;
  selectedSlot: string | null;
  onPickSlot: (isoInstant: string) => void;
  /** Day to open on, e.g. the current time of a booking being rescheduled. */
  initialDate?: string;
};

type Selection =
  | { kind: 'explicit'; date: string }
  | { kind: 'browse' }
  | { kind: 'hunt'; after: string | null };

function initialSelection(initialDate: string | undefined): Selection {
  return initialDate ? { kind: 'explicit', date: initialDate } : { kind: 'hunt', after: null };
}

export function TimePicker({
  lang,
  t,
  timezone,
  businessName,
  minNoticeMin,
  maxAdvanceDays,
  today,
  horizon,
  fetcher,
  resetKey,
  enabled,
  selectedSlot,
  onPickSlot,
  initialDate,
}: TimePickerProps) {
  const availability = useAvailability({
    fetcher,
    timezone,
    today,
    horizon,
    lang,
    enabled,
    resetKey,
    initialMonth: initialDate ?? today,
  });

  const { days, isMonthLoaded, error, canGoNext, stepMonth, goToMonth, monthAnchor } = availability;

  const [selection, setSelection] = useState<Selection>(() => initialSelection(initialDate));

  // A new service invalidates the chosen day as well as the cached slots: the same
  // 10:15 may not exist for a 90-minute treatment. Adjusted during render rather than in
  // an effect, so no frame ever shows the new service beside the old service's times.
  const [activeReset, setActiveReset] = useState(resetKey);
  if (activeReset !== resetKey) {
    setActiveReset(resetKey);
    setSelection(initialSelection(initialDate));
  }

  /** The first day with openings in the loaded month, respecting a hunt's floor. */
  const firstOpen = useMemo(() => {
    if (selection.kind === 'explicit') return null;
    const after = selection.kind === 'hunt' ? selection.after : null;
    return (
      Object.values(days)
        .filter((day) => day.state === 'open' && (after === null || day.date > after))
        .map((day) => day.date)
        .sort()[0] ?? null
    );
  }, [selection, days]);

  const selectedDate = selection.kind === 'explicit' ? selection.date : firstOpen;

  const searching =
    selection.kind === 'hunt' && !error && (!isMonthLoaded || (firstOpen === null && canGoNext));

  /** Hunted all the way to the horizon and found nothing. */
  const exhausted =
    selection.kind === 'hunt' && !error && isMonthLoaded && firstOpen === null && !canGoNext;

  /** Turned the page to a month that has nothing in it. */
  const emptyMonth = selection.kind === 'browse' && !error && isMonthLoaded && firstOpen === null;

  // The only side effect in this component: keep walking forward while hunting. It sets
  // no state of its own — the selection above is derived — so there are no cascading
  // renders, and `canGoNext` bounds the walk at the booking horizon.
  useEffect(() => {
    if (!enabled || error) return;
    if (selection.kind !== 'hunt') return;
    if (!isMonthLoaded || firstOpen !== null || !canGoNext) return;
    stepMonth(1);
  }, [enabled, error, selection, isMonthLoaded, firstOpen, canGoNext, stepMonth]);

  const selectDay = useCallback((dateKey: string) => {
    setSelection({ kind: 'explicit', date: dateKey });
  }, []);

  const changeMonth = useCallback(
    (months: number) => {
      stepMonth(months);
      // Show that month's first opening, but do not go wandering into the next one.
      setSelection({ kind: 'browse' });
    },
    [stepMonth],
  );

  const huntFrom = useCallback((afterDate: string | null) => {
    setSelection({ kind: 'hunt', after: afterDate });
  }, []);

  const jumpToHorizon = useCallback(() => {
    goToMonth(horizon);
    setSelection({ kind: 'explicit', date: horizon });
  }, [goToMonth, horizon]);

  return (
    <div className="flex flex-col gap-5">
      <DayCalendar
        monthAnchor={monthAnchor}
        timezone={timezone}
        lang={lang}
        t={t}
        today={today}
        days={days}
        loading={availability.loading}
        unavailable={error !== null}
        selected={selectedDate}
        onSelect={selectDay}
        onStepMonth={changeMonth}
        canGoPrev={availability.canGoPrev}
        canGoNext={canGoNext}
      />

      <div className="border-t border-line pt-5">
        <DayPanel
          lang={lang}
          t={t}
          timezone={timezone}
          businessName={businessName}
          minNoticeMin={minNoticeMin}
          maxAdvanceDays={maxAdvanceDays}
          horizon={horizon}
          monthAnchor={monthAnchor}
          error={error}
          onRetry={availability.retry}
          loading={availability.loading || searching}
          searching={searching}
          exhausted={exhausted}
          emptyMonth={emptyMonth}
          selectedDate={selectedDate}
          day={selectedDate ? days[selectedDate] : undefined}
          selectedSlot={selectedSlot}
          onPickSlot={onPickSlot}
          onFindNextOpen={huntFrom}
          onJumpToHorizon={jumpToHorizon}
        />
      </div>
    </div>
  );
}

type DayPanelProps = {
  lang: Lang;
  t: (key: string) => string;
  timezone: string;
  businessName: string;
  minNoticeMin: number;
  maxAdvanceDays: number;
  horizon: string;
  monthAnchor: string;
  error: string | null;
  onRetry: () => void;
  loading: boolean;
  searching: boolean;
  exhausted: boolean;
  emptyMonth: boolean;
  selectedDate: string | null;
  day: DayDto | undefined;
  selectedSlot: string | null;
  onPickSlot: (isoInstant: string) => void;
  onFindNextOpen: (afterDate: string | null) => void;
  onJumpToHorizon: () => void;
};

/**
 * The half of the picker that talks.
 *
 * Every branch below ends in either a list of times or a sentence plus a button. There
 * is no path through this component that renders nothing, and no two day states share a
 * message — `closed` is the owner's decision, `full` is not, and telling a customer the
 * wrong one either wastes their time or loses the business a booking.
 */
function DayPanel(props: DayPanelProps) {
  const {
    lang,
    t,
    timezone,
    businessName,
    minNoticeMin,
    maxAdvanceDays,
    horizon,
    monthAnchor,
    error,
    onRetry,
    loading,
    searching,
    exhausted,
    emptyMonth,
    selectedDate,
    day,
    selectedSlot,
    onPickSlot,
    onFindNextOpen,
    onJumpToHorizon,
  } = props;

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} retryLabel={t('booking.error.retry')} />;
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner size="sm" />
        {searching ? t('booking.state.searching') : t('booking.day.loading')}
      </p>
    );
  }

  const horizonAction = (
    <Button variant="secondary" size="sm" onClick={onJumpToHorizon}>
      {t('booking.state.goToHorizon')}
    </Button>
  );

  if (exhausted) {
    return (
      <Notice
        tone="neutral"
        title={t('booking.state.beyond.title')}
        body={fill(t('booking.state.noneAhead'), {
          horizon: formatDateMedium(horizon, timezone, lang),
        })}
        action={horizonAction}
      />
    );
  }

  if (emptyMonth) {
    return (
      <Notice
        tone="neutral"
        title={t('booking.state.full.title')}
        body={fill(t('booking.state.noneThisMonth'), {
          month: formatMonthTitle(monthAnchor, timezone, lang),
        })}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onFindNextOpen(lastOfMonth(monthAnchor, timezone))}
          >
            {t('booking.state.nextOpen')}
          </Button>
        }
      />
    );
  }

  if (!selectedDate) {
    return (
      <Notice
        tone="neutral"
        title={t('booking.day.heading')}
        body={t('booking.state.past.body')}
        action={
          <Button variant="secondary" size="sm" onClick={() => onFindNextOpen(null)}>
            {t('booking.state.nextOpen')}
          </Button>
        }
      />
    );
  }

  const dateLong = formatDateFull(selectedDate, timezone, lang);
  const nextOpenButton = (
    <Button variant="secondary" size="sm" onClick={() => onFindNextOpen(selectedDate)}>
      {t('booking.state.nextOpen')}
    </Button>
  );

  // Outside the loaded range: the same dead end as an unknown day, given a way out.
  if (!day || day.state === 'beyond_horizon') {
    return (
      <Notice
        tone="neutral"
        title={t('booking.state.beyond.title')}
        body={fill(t('booking.state.beyond.body'), {
          business: businessName,
          advance: humaniseDays(maxAdvanceDays, lang),
          horizon: formatDateMedium(horizon, timezone, lang),
        })}
        action={horizonAction}
      />
    );
  }

  if (day.state === 'closed') {
    return (
      <Notice
        tone="neutral"
        title={t('booking.state.closed.title')}
        body={fill(t('booking.state.closed.body'), { business: businessName, date: dateLong })}
        action={nextOpenButton}
      />
    );
  }

  if (day.state === 'full') {
    return (
      <Notice
        tone="warn"
        title={t('booking.state.full.title')}
        body={fill(t('booking.state.full.body'), { date: dateLong })}
        action={nextOpenButton}
      />
    );
  }

  if (day.state === 'too_soon') {
    return (
      <Notice
        tone="neutral"
        title={t('booking.state.tooSoon.title')}
        body={fill(t('booking.state.tooSoon.body'), {
          business: businessName,
          notice: humaniseMinutes(minNoticeMin, lang),
          date: dateLong,
        })}
        action={nextOpenButton}
      />
    );
  }

  if (day.slots.length === 0) {
    // Belt and braces: `open` means at least one slot, so this cannot normally happen.
    return (
      <Notice
        tone="neutral"
        title={t('booking.state.full.title')}
        body={t('booking.slot.none')}
        action={nextOpenButton}
      />
    );
  }

  const groups = groupSlotsByPartOfDay(day.slots, timezone);
  // Headings earn their space only on a day long enough to need scanning, and only when
  // there is more than one part of the day to scan between.
  const showGroupHeadings = groups.length > 1 && day.slots.length > 8;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-ink">
          {t('booking.slot.heading')}
        </h3>
        <p className="text-sm text-muted">
          {day.slots.length === 1
            ? t('booking.day.oneAvailable')
            : fill(t('booking.day.countAvailable'), { n: day.slots.length })}
        </p>
      </div>

      <p className="mt-1 text-sm text-body">{dateLong}</p>

      {groups.map(({ part, slots }) => (
        <section key={part} className="mt-4">
          {showGroupHeadings ? (
            <h4 className="mono-label mb-2 text-muted">{t(`booking.slot.${part}`)}</h4>
          ) : null}

          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((iso) => {
              const isSelected = selectedSlot === iso;
              return (
                <li key={iso}>
                  <button
                    type="button"
                    onClick={() => onPickSlot(iso)}
                    aria-pressed={isSelected}
                    className={cx(
                      'flex h-11 w-full items-center justify-center rounded-sm border text-sm font-medium tabular-nums transition-colors',
                      isSelected
                        ? 'border-blue bg-blue text-surface'
                        : 'border-line bg-surface text-ink hover:border-blue hover:bg-blue-50 hover:text-blue',
                    )}
                  >
                    {formatTime(new Date(iso), timezone)}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
        <ClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{fill(t('booking.slot.timezoneNote'), { business: businessName, timezone })}</span>
      </p>
    </div>
  );
}

function Notice({
  tone,
  title,
  body,
  action,
}: {
  tone: 'neutral' | 'warn';
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-start gap-2 rounded-sm px-4 py-4',
        tone === 'warn' ? 'bg-warn-soft' : 'bg-panel',
      )}
    >
      <p
        className={cx(
          'font-display text-base font-semibold',
          tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
      >
        {title}
      </p>
      <p className="text-sm text-body">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
