'use client';

import { useState } from 'react';
import { Button, ConfirmDialog, Field, Select, Sheet, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import {
  addClosureAction,
  addDateOverrideAction,
  addWorkingHoursAction,
  deleteClosureAction,
  deleteDateOverrideAction,
  deleteWorkingHoursAction,
} from '../_actions/hours';
import { adminDictionary } from '../dictionary';
import { interpolate } from '../format';
import type { ClosureView, HoursRowView, OverrideView } from '../types';
import { parseTimeRange, type Invalid } from '../validation';
import { Banner } from './Banner';
import { Icon } from './Icon';
import { useAdminAction } from './useAdminAction';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

type Pending =
  | { kind: 'hours'; row: HoursRowView }
  | { kind: 'closure'; row: ClosureView }
  | { kind: 'override'; row: OverrideView };

/**
 * Opening hours, closed dates and one-off hours.
 *
 * ⚠ The rule this screen exists to get right: **a start and an end are validated
 * together, here, before anything is sent.** The predecessor shipped two independent
 * time pickers with no cross-check and happily persisted a closure whose end was before
 * its start. It blocked zero minutes, so customers booked straight through hours the
 * owner believed were shut, and nothing errored — not in the form, not in the database,
 * not in a log. `parseTimeRange` is the same function the Server Action runs again, and
 * the schema's `CHECK (end_min > start_min)` is the same rule a third time.
 */
export function HoursManager({
  hours,
  closures,
  overrides,
  today,
}: {
  hours: HoursRowView[];
  closures: ClosureView[];
  overrides: OverrideView[];
  today: string;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [addingHoursFor, setAddingHoursFor] = useState<number | null>(null);
  const [addingClosure, setAddingClosure] = useState(false);
  const [addingOverride, setAddingOverride] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const removeHours = useAdminAction(deleteWorkingHoursAction, {
    lang,
    onSuccess: () => setPending(null),
  });
  const removeClosure = useAdminAction(deleteClosureAction, {
    lang,
    onSuccess: () => setPending(null),
  });
  const removeOverride = useAdminAction(deleteDateOverrideAction, {
    lang,
    onSuccess: () => setPending(null),
  });

  const removal =
    pending?.kind === 'hours'
      ? removeHours
      : pending?.kind === 'closure'
        ? removeClosure
        : removeOverride;

  function confirmRemoval() {
    if (!pending) return;
    void removal.run(pending.row.id);
  }

  const removalCopy = (() => {
    if (!pending) return { title: '', message: '' };
    if (pending.kind === 'hours') {
      return {
        title: t('hrs.removeRowTitle'),
        message: interpolate(t('hrs.removeRowMessage'), {
          day: t(`wd.${pending.row.weekday}`),
          range: pending.row.range,
        }),
      };
    }
    if (pending.kind === 'closure') {
      return {
        title: t('hrs.removeClosureTitle'),
        message: interpolate(t('hrs.removeClosureMessage'), { date: pending.row.dateLabel }),
      };
    }
    return {
      title: t('hrs.removeOverrideTitle'),
      message: interpolate(t('hrs.removeOverrideMessage'), { date: pending.row.dateLabel }),
    };
  })();

  return (
    <div className="flex flex-col gap-8">
      {/* ── Weekly template ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{t('hrs.weekly')}</h2>
          <p className="text-sm text-body">{t('hrs.weeklyIntro')}</p>
        </div>

        <ul className="flex flex-col gap-2">
          {WEEKDAYS.map((weekday) => {
            const rows = hours.filter((row) => row.weekday === weekday);

            return (
              <li
                key={weekday}
                className="rounded-md border border-line bg-surface px-4 py-3 shadow-soft"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{t(`wd.${weekday}`)}</p>
                  <Button size="sm" variant="ghost" onClick={() => setAddingHoursFor(weekday)}>
                    <Icon name="plus" size={16} />
                    {t('hrs.addRow')}
                  </Button>
                </div>

                {rows.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">{t('hrs.closedDay')}</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1">
                    {rows.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3">
                        <span className="mono-label text-ink">{row.range}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPending({ kind: 'hours', row })}
                        >
                          {t('a.delete')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Closed dates ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{t('hrs.closures')}</h2>
          <p className="text-sm text-body">{t('hrs.closuresIntro')}</p>
        </div>

        <Button variant="secondary" onClick={() => setAddingClosure(true)}>
          <Icon name="plus" size={16} />
          {t('hrs.addClosure')}
        </Button>

        {closures.length === 0 ? (
          <p className="text-sm text-muted">{t('hrs.noClosures')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {closures.map((closure) => (
              <li
                key={closure.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-ink">{closure.dateLabel}</span>
                  <span className="block text-sm text-muted">
                    {closure.range ?? t('hrs.wholeDay')}
                    {closure.label ? ` · ${closure.label}` : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPending({ kind: 'closure', row: closure })}
                >
                  {t('a.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── One-off hours ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{t('hrs.overrides')}</h2>
          <p className="text-sm text-body">{t('hrs.overridesIntro')}</p>
        </div>

        <Button variant="secondary" onClick={() => setAddingOverride(true)}>
          <Icon name="plus" size={16} />
          {t('hrs.addOverride')}
        </Button>

        {overrides.length === 0 ? (
          <p className="text-sm text-muted">{t('hrs.noOverrides')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {overrides.map((override) => (
              <li
                key={override.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-ink">{override.dateLabel}</span>
                  <span className="block text-sm text-muted">
                    {override.range}
                    {override.label ? ` · ${override.label}` : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPending({ kind: 'override', row: override })}
                >
                  {t('a.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {addingHoursFor !== null ? (
        <AddHoursSheet
          key={`hours-${addingHoursFor}`}
          weekday={addingHoursFor}
          onClose={() => setAddingHoursFor(null)}
        />
      ) : null}

      {addingClosure ? (
        <AddClosureSheet today={today} onClose={() => setAddingClosure(false)} />
      ) : null}

      {addingOverride ? (
        <AddOverrideSheet today={today} onClose={() => setAddingOverride(false)} />
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onCancel={() => {
          setPending(null);
          removal.reset();
        }}
        onConfirm={confirmRemoval}
        title={removalCopy.title}
        message={
          <>
            {removalCopy.message}
            {removal.error ? (
              <span role="alert" className="mt-3 block text-danger">
                {removal.error}
              </span>
            ) : null}
          </>
        }
        confirmLabel={t('a.delete')}
        cancelLabel={t('a.cancel')}
        closeLabel={t('a.close')}
        confirmPending={removal.pending}
      />
    </div>
  );
}

/**
 * The shared cross-field check.
 *
 * Runs before the network call so the owner is told instantly, and the identical call
 * runs again inside the Server Action — client-side validation proves nothing about a
 * Server Function, which is reachable by direct POST.
 */
function checkRange(start: string, end: string): Invalid | null {
  const result = parseTimeRange(start, end, { start: 'start', end: 'end' });
  return result.ok ? null : result;
}

function AddHoursSheet({ weekday, onClose }: { weekday: number; onClose: () => void }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [day, setDay] = useState(String(weekday));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [local, setLocal] = useState<Invalid | null>(null);

  const add = useAdminAction(addWorkingHoursAction, { lang, onSuccess: onClose });

  function submit() {
    const problem = checkRange(start, end);
    setLocal(problem);
    if (problem) return;
    void add.run({ weekday: Number(day), start, end });
  }

  const fieldError = (field: string) =>
    local?.field === field ? t(`hrs.error.${local.code}`) : add.fieldError(field);

  return (
    <Sheet
      open
      onClose={onClose}
      closeLabel={t('a.close')}
      title={t('hrs.addRow')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('a.cancel')}
          </Button>
          <Button loading={add.pending} onClick={submit}>
            {t('a.add')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label={t('hrs.weekly')}
          value={day}
          onChange={(event) => setDay(event.target.value)}
          options={WEEKDAYS.map((value) => ({ value: String(value), label: t(`wd.${value}`) }))}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('hrs.from')}
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            error={fieldError('start')}
          />
          <Field
            label={t('hrs.to')}
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            error={fieldError('end')}
          />
        </div>

        {add.error && !add.failure?.field ? <Banner tone="danger">{add.error}</Banner> : null}
      </div>
    </Sheet>
  );
}

function AddClosureSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [date, setDate] = useState(today);
  const [wholeDay, setWholeDay] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [label, setLabel] = useState('');
  const [local, setLocal] = useState<Invalid | null>(null);

  const add = useAdminAction(addClosureAction, { lang, onSuccess: onClose });

  function submit() {
    // Only cross-check when a part-day closure is actually being described. A whole-day
    // closure legitimately has no times at all — that is what NULL start/end mean.
    const problem = wholeDay ? null : checkRange(start, end);
    setLocal(problem);
    if (problem) return;
    void add.run({ date, wholeDay, start, end, label });
  }

  const fieldError = (field: string) =>
    local?.field === field ? t(`hrs.error.${local.code}`) : add.fieldError(field);

  return (
    <Sheet
      open
      onClose={onClose}
      closeLabel={t('a.close')}
      title={t('hrs.addClosure')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('a.cancel')}
          </Button>
          <Button loading={add.pending} onClick={submit}>
            {t('a.add')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t('hrs.closureDate')}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={fieldError('date')}
          required
        />

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={wholeDay}
            onChange={(event) => setWholeDay(event.target.checked)}
            className="h-5 w-5 shrink-0"
          />
          <span className="text-sm text-ink">{t('hrs.closureWholeDay')}</span>
        </label>

        {!wholeDay ? (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('hrs.from')}
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              error={fieldError('start')}
            />
            <Field
              label={t('hrs.to')}
              type="time"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              error={fieldError('end')}
            />
          </div>
        ) : null}

        <Field
          label={`${t('hrs.closureLabel')} (${t('a.optional')})`}
          hint={t('hrs.closureLabelHint')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />

        {add.error && !add.failure?.field ? <Banner tone="danger">{add.error}</Banner> : null}
      </div>
    </Sheet>
  );
}

function AddOverrideSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [date, setDate] = useState(today);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('14:00');
  const [label, setLabel] = useState('');
  const [local, setLocal] = useState<Invalid | null>(null);

  const add = useAdminAction(addDateOverrideAction, { lang, onSuccess: onClose });

  function submit() {
    const problem = checkRange(start, end);
    setLocal(problem);
    if (problem) return;
    void add.run({ date, start, end, label });
  }

  const fieldError = (field: string) =>
    local?.field === field ? t(`hrs.error.${local.code}`) : add.fieldError(field);

  return (
    <Sheet
      open
      onClose={onClose}
      closeLabel={t('a.close')}
      title={t('hrs.addOverride')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('a.cancel')}
          </Button>
          <Button loading={add.pending} onClick={submit}>
            {t('a.add')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-body">{t('hrs.overridesIntro')}</p>

        <Field
          label={t('hrs.closureDate')}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={fieldError('date')}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('hrs.from')}
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            error={fieldError('start')}
          />
          <Field
            label={t('hrs.to')}
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            error={fieldError('end')}
          />
        </div>

        <Field
          label={`${t('hrs.closureLabel')} (${t('a.optional')})`}
          hint={t('hrs.closureLabelHint')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />

        {add.error && !add.failure?.field ? <Banner tone="danger">{add.error}</Banner> : null}
      </div>
    </Sheet>
  );
}
