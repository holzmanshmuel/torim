'use client';

/**
 * What the customer can do with their own booking: look at it, move it, cancel it.
 *
 * Three things this screen is careful about.
 *
 * 1. **The cancellation window is explained before it is enforced.** A cancel button
 *    that only fails when pressed teaches the customer nothing; inside the window the
 *    button is replaced by the reason and a way to reach a human.
 *
 * 2. **Rescheduling excludes this booking from its own availability.** That is handled
 *    server-side by `rescheduleByManageToken`, but it is why the sheet uses the manage
 *    availability action rather than the public one — otherwise the appointment blocks
 *    its own move and no time is ever offered.
 *
 * 3. **Nothing sticks.** Cancel and reschedule both run through `useAsyncAction`, so a
 *    slow or failed call always releases the button and always says something.
 */
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  OpenWhatsApp,
  Sheet,
  StatusPill,
  useAsyncAction,
} from '@/app/components';
import { getT, type Lang } from '@/lib/i18n';
import { instantToDateKey } from '@/lib/time';
import { bookingDictionary } from '../b/dictionary';
import { CalendarIcon } from '../b/icons';
import {
  fill,
  formatDateFull,
  formatDateMedium,
  formatDuration,
  formatPhone,
  formatPrice,
  formatTimeRange,
} from '../b/lib/format';
import type { BookingStatus, BusinessDto } from '../b/lib/types';
import { TimePicker } from '../b/TimePicker';
import type { AvailabilityFetcher } from '../b/useAvailability';
import {
  cancelAppointment,
  loadManageAvailability,
  rescheduleAppointment,
} from './actions';

export type ManageBookingProps = {
  lang: Lang;
  token: string;
  business: BusinessDto;
  businessName: string;
  serviceName: string;
  booking: {
    status: BookingStatus;
    startsAt: string;
    endsAt: string;
    priceMinor: number;
  };
  customerName: string;
  customerPhone: string;
  today: string;
  horizon: string;
  /** Server's instant at render, so the cancellation window is judged by one clock. */
  nowIso: string;
};

const PILL_VARIANT: Record<BookingStatus, 'confirmed' | 'pending' | 'cancelled' | 'no_show'> = {
  confirmed: 'confirmed',
  pending: 'pending',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

export function ManageBooking(props: ManageBookingProps) {
  const {
    lang,
    token,
    business,
    businessName,
    serviceName,
    customerName,
    customerPhone,
    today,
    horizon,
    nowIso,
  } = props;

  const t = useMemo(() => getT(lang, bookingDictionary), [lang]);

  const [status, setStatus] = useState<BookingStatus>(props.booking.status);
  const [startsAt, setStartsAt] = useState(props.booking.startsAt);
  const [endsAt, setEndsAt] = useState(props.booking.endsAt);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateKey = instantToDateKey(start, business.timezone);
  const when = `${formatDateFull(dateKey, business.timezone, lang)}, ${formatTimeRange(start, end, business.timezone)}`;
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);

  const isActive = status === 'pending' || status === 'confirmed';
  const isPast = end.getTime() <= new Date(nowIso).getTime();
  const withinCancellationWindow =
    start.getTime() - new Date(nowIso).getTime() < business.cancellationWindowMin * 60_000;

  const fetcher = useCallback<AvailabilityFetcher>(
    async (from, to) => {
      const result = await loadManageAvailability({ token, from, to });
      if (!result.ok) throw new Error(result.message);
      return { days: result.days, today: result.today, horizon: result.horizon };
    },
    [token],
  );

  const {
    run: runCancel,
    pending: cancelling,
    error: cancelError,
  } = useAsyncAction(async () => {
    const result = await cancelAppointment({ token });
    if (result.ok) {
      setStatus(result.status);
      setConfirmOpen(false);
      setNotice(t('manage.cancel.done'));
      setBlocker(null);
      return;
    }
    if (result.code === 'too_late_to_cancel') {
      setConfirmOpen(false);
      setBlocker(result.message);
      return;
    }
    throw new Error(result.message);
  }, { lang });

  const {
    run: runReschedule,
    pending: rescheduling,
    error: rescheduleError,
  } = useAsyncAction(async () => {
    if (!pendingSlot) return;

    const result = await rescheduleAppointment({ token, startsAt: pendingSlot });
    if (result.ok) {
      setStartsAt(result.startsAt);
      setEndsAt(result.endsAt);
      setStatus(result.status);
      setSheetOpen(false);
      setPendingSlot(null);
      setNotice(t('manage.reschedule.done'));
      return;
    }
    if (result.code === 'slot_taken') {
      // Refresh the calendar in place rather than closing it: the customer is still
      // trying to move the appointment, they just need a different time.
      setPendingSlot(null);
      setEpoch((value) => value + 1);
    }
    throw new Error(result.message);
  }, { lang });

  const pendingStart = pendingSlot ? new Date(pendingSlot) : null;
  const pendingWhen = pendingStart
    ? `${formatDateMedium(instantToDateKey(pendingStart, business.timezone), business.timezone, lang)} · ${formatTimeRange(pendingStart, new Date(pendingStart.getTime() + durationMin * 60_000), business.timezone)}`
    : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="overflow-hidden rounded-md border border-line bg-surface shadow-soft">
        <div aria-hidden="true" className="h-1.5 w-full bg-blue" />
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5 sm:px-6">
          <div>
            <p className="mono-label text-muted">{t('manage.heading')}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
              {businessName}
            </h1>
            <p className="mt-1 text-sm text-body">
              {fill(t('manage.bookedFor'), { name: customerName })}
            </p>
          </div>
          <StatusPill variant={PILL_VARIANT[status]}>{t(`booking.status.${status}`)}</StatusPill>
        </div>
      </header>

      {notice ? (
        <p role="status" className="rounded-sm bg-ok-soft px-4 py-3 text-sm text-ok">
          {notice}
        </p>
      ) : null}

      <Card>
        <dl className="flex flex-col divide-y divide-line-2">
          <Row label={t('booking.summary.service')} value={serviceName} />
          <Row label={t('booking.summary.when')} value={when} />
          <Row label={t('booking.summary.duration')} value={formatDuration(durationMin, lang)} />
          <Row
            label={t('booking.summary.price')}
            value={formatPrice(props.booking.priceMinor, business.currency, lang)}
          />
          <Row label={t('booking.summary.phone')} value={formatPhone(customerPhone)} />
        </dl>
      </Card>

      {status === 'pending' ? (
        <Notice tone="warn" body={fill(t('manage.pending.note'), { business: businessName })} />
      ) : null}

      {status === 'cancelled' ? (
        <Notice tone="neutral" title={t('manage.cancelled.title')} body={t('manage.cancelled.body')} />
      ) : null}

      {status === 'no_show' ? (
        <Notice tone="neutral" title={t('manage.noShow.title')} body={t('manage.noShow.body')} />
      ) : null}

      {isActive && isPast ? (
        <Notice tone="neutral" title={t('manage.past.title')} body={t('manage.past.body')} />
      ) : null}

      {blocker ? (
        <Notice tone="warn" title={t('manage.cancel.tooLate.title')} body={blocker} />
      ) : null}

      {isActive && !isPast && withinCancellationWindow && !blocker ? (
        <Notice
          tone="warn"
          title={t('manage.cancel.tooLate.title')}
          body={fill(t('manage.cancel.tooLate.body'), {
            business: businessName,
            window: formatDuration(business.cancellationWindowMin, lang),
          })}
        />
      ) : null}

      {cancelError ? (
        <p role="alert" className="text-sm text-danger">
          {cancelError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {isActive && !isPast ? (
          <>
            <Button onClick={() => setSheetOpen(true)}>{t('manage.actions.reschedule')}</Button>

            {!withinCancellationWindow ? (
              <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
                {t('manage.actions.cancel')}
              </Button>
            ) : null}
          </>
        ) : null}

        {isActive ? (
          <a
            href={`/api/public/ics/${token}`}
            download
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
          >
            <CalendarIcon className="h-4 w-4" />
            {t('manage.actions.addToCalendar')}
          </a>
        ) : null}

        {business.whatsappPhone ? (
          <OpenWhatsApp
            phone={business.whatsappPhone}
            lang={lang}
            label={fill(t('manage.whatsapp'), { business: businessName })}
            message={fill(t('manage.whatsappMessage'), { when })}
          />
        ) : null}
      </div>

      <div>
        <Link
          href={`/b/${business.slug}`}
          className="text-sm text-blue underline-offset-2 hover:underline"
        >
          {t('manage.bookAnother')}
        </Link>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void runCancel()}
        title={t('manage.cancel.title')}
        message={fill(t('manage.cancel.message'), { service: serviceName, when })}
        confirmLabel={t('manage.cancel.confirm')}
        cancelLabel={t('manage.actions.keep')}
        closeLabel={t('booking.close')}
        confirmPending={cancelling}
      />

      <Sheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setPendingSlot(null);
        }}
        title={t('manage.reschedule.title')}
        closeLabel={t('booking.close')}
        footer={
          <div className="flex flex-col gap-2">
            {rescheduleError ? (
              <p role="alert" className="text-sm text-danger">
                {rescheduleError}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={!pendingSlot}
              loading={rescheduling}
              onClick={() => void runReschedule()}
            >
              {pendingWhen
                ? fill(t('manage.reschedule.confirm'), { when: pendingWhen })
                : t('manage.reschedule.pickFirst')}
            </Button>
          </div>
        }
      >
        <p className="mb-4 text-sm text-muted">
          {fill(t('manage.reschedule.current'), { when })}
        </p>

        <TimePicker
          lang={lang}
          t={t}
          timezone={business.timezone}
          businessName={businessName}
          minNoticeMin={business.minNoticeMin}
          maxAdvanceDays={business.maxAdvanceDays}
          today={today}
          horizon={horizon}
          fetcher={fetcher}
          resetKey={`${token}:${epoch}`}
          enabled={sheetOpen}
          selectedSlot={pendingSlot}
          onPickSlot={setPendingSlot}
          initialDate={dateKey >= today ? dateKey : undefined}
        />
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-end text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function Notice({
  tone,
  title,
  body,
}: {
  tone: 'neutral' | 'warn';
  title?: string;
  body: string;
}) {
  return (
    <div
      className={
        tone === 'warn'
          ? 'rounded-sm bg-warn-soft px-4 py-3'
          : 'rounded-sm bg-panel px-4 py-3'
      }
    >
      {title ? (
        <p
          className={
            tone === 'warn'
              ? 'font-display text-base font-semibold text-warn'
              : 'font-display text-base font-semibold text-ink'
          }
        >
          {title}
        </p>
      ) : null}
      <p className={tone === 'warn' ? 'text-sm text-warn' : 'text-sm text-body'}>{body}</p>
    </div>
  );
}
