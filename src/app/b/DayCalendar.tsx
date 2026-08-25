'use client';

/**
 * The month calendar.
 *
 * The rule that shapes this component: **every day leads somewhere**. A day the customer
 * can tap but which then does nothing was reported three separate times, by three
 * different reviewers, on the predecessor project — so every bookable-range cell is a
 * real `<button>` that always selects, and the panel below always says something. The
 * only cells that are not buttons are days that have already passed, where "no" is the
 * whole story and the calendar convention already tells it.
 *
 * The second rule: **`closed` and `full` never look the same**. One is the owner's
 * decision and the other is not, and collapsing them invites a customer to keep checking
 * back on a day the salon has deliberately shut. They differ here in background, in text
 * colour, in the marker under the number, in the accessible label, and in the panel text.
 */
import { cx } from '@/app/components';
import type { Lang } from '@/lib/i18n';
import { ChevronEnd, ChevronStart } from './icons';
import {
  dayOfMonth,
  formatDateFull,
  formatMonthTitle,
  monthGrid,
  monthKeyOf,
  weekdayInitials,
  weekdayNames,
} from './lib/format';
import type { DayDto, DayState } from './lib/types';

export type DayCalendarProps = {
  monthAnchor: string;
  timezone: string;
  lang: Lang;
  t: (key: string) => string;
  /** Business-local today and the last bookable day, both resolved server-side. */
  today: string;
  days: Record<string, DayDto>;
  loading: boolean;
  /**
   * True when availability could not be loaded at all — a network failure, or a rate
   * limit. The grid then renders as *unknown* rather than as a month of unbookable days.
   *
   * This is not cosmetic. A greyed-out calendar and a closed business look identical, and
   * on the predecessor project a shared office IP tripping the rate limit did exactly
   * that: every customer behind it saw what looked like a salon shut for the month, and
   * nobody reported it because nothing appeared to be broken. The explanation lives in
   * the panel below; this flag stops the grid contradicting it.
   */
  unavailable: boolean;
  selected: string | null;
  onSelect: (dateKey: string) => void;
  onStepMonth: (months: number) => void;
  canGoPrev: boolean;
  canGoNext: boolean;
};

const CELL_BASE =
  'relative flex h-12 w-full flex-col items-center justify-center gap-1 rounded-sm text-sm transition-colors';

const STATE_CELL: Record<DayState, string> = {
  open: 'bg-surface font-medium text-ink border border-line hover:border-blue hover:bg-blue-50',
  full: 'bg-warn-soft text-warn',
  closed: 'bg-panel text-muted',
  too_soon: 'bg-panel text-muted',
  beyond_horizon: 'text-muted opacity-50',
};

const STATE_MARKER: Record<DayState, string> = {
  open: 'bg-blue',
  full: 'bg-warn',
  // Hollow, not filled — a shut door rather than a taken seat.
  closed: 'border border-muted bg-transparent',
  too_soon: 'bg-muted',
  beyond_horizon: 'bg-transparent',
};

const STATE_LABEL_KEY: Record<DayState, string> = {
  open: 'booking.day.legendOpen',
  full: 'booking.day.legendFull',
  closed: 'booking.day.legendClosed',
  too_soon: 'booking.day.legendOther',
  beyond_horizon: 'booking.day.legendOther',
};

function Legend({ t }: { t: (key: string) => string }) {
  const items: Array<[DayState, string]> = [
    ['open', t('booking.day.legendOpen')],
    ['full', t('booking.day.legendFull')],
    ['closed', t('booking.day.legendClosed')],
    ['too_soon', t('booking.day.legendOther')],
  ];

  return (
    <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {items.map(([state, label]) => (
        <li key={state} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cx('inline-block h-1.5 w-1.5 rounded-full', STATE_MARKER[state])}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function DayCalendar({
  monthAnchor,
  timezone,
  lang,
  t,
  today,
  days,
  loading,
  unavailable,
  selected,
  onSelect,
  onStepMonth,
  canGoPrev,
  canGoNext,
}: DayCalendarProps) {
  const grid = monthGrid(monthAnchor, timezone);
  const activeMonth = monthKeyOf(monthAnchor);
  const initials = weekdayInitials(lang);
  const names = weekdayNames(lang);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onStepMonth(-1)}
          disabled={!canGoPrev}
          aria-label={t('booking.day.prevMonth')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-body transition-colors hover:bg-panel hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
        >
          {/* The chevron follows the reading direction, so "previous" always points back. */}
          <ChevronStart className="h-5 w-5 rtl:rotate-180" />
        </button>

        <h3 aria-live="polite" className="font-display text-base font-semibold text-ink">
          {formatMonthTitle(monthAnchor, timezone, lang)}
        </h3>

        <button
          type="button"
          onClick={() => onStepMonth(1)}
          disabled={!canGoNext}
          aria-label={t('booking.day.nextMonth')}
          className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-body transition-colors hover:bg-panel hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronEnd className="h-5 w-5 rtl:rotate-180" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1" aria-hidden="true">
        {initials.map((initial, index) => (
          <div
            key={names[index]}
            className="flex h-8 items-center justify-center text-xs font-medium text-muted"
          >
            {initial}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((dateKey) => {
          if (monthKeyOf(dateKey) !== activeMonth) {
            return <div key={dateKey} className="h-12" />;
          }

          const label = formatDateFull(dateKey, timezone, lang);
          const isToday = dateKey === today;

          // Availability is unknown, not absent. Say nothing about it either visually or
          // to a screen reader; the panel below carries the actual explanation.
          if (unavailable) {
            return (
              <div
                key={dateKey}
                aria-hidden="true"
                className="flex h-12 w-full items-center justify-center rounded-sm border border-dashed border-line text-sm text-muted opacity-50"
              >
                {dayOfMonth(dateKey)}
              </div>
            );
          }

          // Already gone. Not a button: there is nothing to say beyond what a greyed-out
          // past date on a calendar already says, and a disabled button that announces
          // itself on every arrow-key pass only adds noise.
          if (dateKey < today) {
            return (
              <div
                key={dateKey}
                className="flex h-12 w-full items-center justify-center text-sm text-muted opacity-40"
              >
                <span aria-hidden="true">{dayOfMonth(dateKey)}</span>
                <span className="sr-only">{`${label} — ${t('booking.day.inPast')}`}</span>
              </div>
            );
          }

          const day = days[dateKey];

          if (!day) {
            return loading ? (
              <div
                key={dateKey}
                aria-hidden="true"
                className="flex h-12 w-full animate-pulse items-center justify-center rounded-sm bg-panel text-sm text-muted opacity-60"
              >
                {dayOfMonth(dateKey)}
              </div>
            ) : (
              <div
                key={dateKey}
                className="flex h-12 w-full items-center justify-center rounded-sm text-sm text-muted opacity-40"
              >
                <span aria-hidden="true">{dayOfMonth(dateKey)}</span>
                <span className="sr-only">{`${label} — ${t('booking.day.legendOther')}`}</span>
              </div>
            );
          }

          const isSelected = selected === dateKey;
          const stateLabel = t(STATE_LABEL_KEY[day.state]);

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelect(dateKey)}
              aria-pressed={isSelected}
              aria-label={`${label} — ${stateLabel}${isToday ? `, ${t('booking.day.today')}` : ''}`}
              className={cx(
                CELL_BASE,
                isSelected
                  ? 'bg-blue font-semibold text-surface shadow-soft'
                  : STATE_CELL[day.state],
                !isSelected && isToday ? 'ring-1 ring-blue' : undefined,
              )}
            >
              <span aria-hidden="true">{dayOfMonth(dateKey)}</span>
              <span
                aria-hidden="true"
                className={cx(
                  'block h-1.5 w-1.5 rounded-full',
                  isSelected
                    ? day.state === 'open'
                      ? 'bg-surface'
                      : 'bg-surface/50'
                    : STATE_MARKER[day.state],
                )}
              />
            </button>
          );
        })}
      </div>

      {unavailable ? null : <Legend t={t} />}
    </div>
  );
}
