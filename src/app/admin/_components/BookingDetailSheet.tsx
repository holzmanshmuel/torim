'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Button,
  ConfirmDialog,
  Field,
  Sheet,
  StatusPill,
  useLang,
} from '@/app/components';
import { getT } from '@/lib/i18n';
import {
  cancelBookingAction,
  confirmBookingAction,
  markNoShowAction,
  markSeenAction,
  moveBookingAction,
  saveBookingNoteAction,
} from '../_actions/bookings';
import { colourHex } from '../colours';
import { adminDictionary } from '../dictionary';
import { interpolate, telHref } from '../format';
import { bookingOptimism } from '../optimistic-store';
import type { BookingView, ClashInfo } from '../types';
import { Banner } from './Banner';
import { Icon } from './Icon';
import { useAdminAction } from './useAdminAction';
import { WhatsAppComposer } from './WhatsAppComposer';

type Props = {
  /** Always a real booking: the parent renders this component keyed on the id, so
   *  opening a different appointment remounts it and every field re-seeds itself. */
  booking: BookingView;
  onClose: () => void;
};

/**
 * Everything the owner can do to one appointment.
 *
 * Three things here are load-bearing rather than stylistic:
 *
 *  - Every server call goes through `useAdminAction`, so no button can stick on "one
 *    moment…" and every failure lands somewhere visible.
 *  - Cancel and no-show confirm through `ConfirmDialog` naming *this* customer at *this*
 *    time — never a bare "Are you sure?".
 *  - Moving runs the same clash flow as creating. The predecessor's admin move path had
 *    no conflict check at all and double-booked in silence; here an overlap has to be
 *    read and then chosen, and the confirmation afterwards names what it landed on.
 */
export function BookingDetailSheet({ booking, onClose }: Props) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  // Seeded once from props. There is no effect resyncing these, because the parent keys
  // this component on the booking id: a different appointment is a different mount, and
  // a router refresh that returns an equivalent booking cannot wipe a half-typed note.
  const [note, setNote] = useState(booking.note ?? '');
  const [moveDate, setMoveDate] = useState(booking.dateKey);
  const [moveTime, setMoveTime] = useState(booking.timeValue);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'cancel' | 'no_show' | null>(null);

  /**
   * The server state an optimistic patch is applied over. Read from props, so the store
   * can tell later whether the server has caught up or moved on elsewhere.
   */
  const serverState = { status: booking.status, needsAttention: booking.needsAttention };

  const seen = useAdminAction(markSeenAction, {
    lang,
    onSuccess: () => {
      bookingOptimism.apply(booking.id, serverState, { needsAttention: false });
    },
  });

  const confirm = useAdminAction(confirmBookingAction, {
    lang,
    onSuccess: () => {
      bookingOptimism.apply(booking.id, serverState, { status: 'confirmed' });
      setFlash(t('bk.confirmed'));
    },
  });

  const cancel = useAdminAction(cancelBookingAction, {
    lang,
    onSuccess: () => {
      bookingOptimism.apply(booking.id, serverState, { status: 'cancelled' });
      setConfirming(null);
      setFlash(t('bk.cancelled'));
    },
  });

  const noShow = useAdminAction(markNoShowAction, {
    lang,
    onSuccess: () => {
      bookingOptimism.apply(booking.id, serverState, { status: 'no_show' });
      setConfirming(null);
      setFlash(t('bk.noShowDone'));
    },
  });

  const saveNote = useAdminAction(saveBookingNoteAction, {
    lang,
    onSuccess: () => setFlash(t('bk.noteSaved')),
  });

  const move = useAdminAction(moveBookingAction, {
    lang,
    onSuccess: (value) => {
      setFlash(
        value.overlapped && value.overlappedWith
          ? interpolate(t('clash.overlapped'), {
              when: value.overlappedWith.when,
              name: value.overlappedWith.customerName,
            })
          : interpolate(t('bk.moved'), { value: value.when }),
      );
    },
  });

  const clash: ClashInfo | undefined =
    move.failure?.code === 'conflict' ? move.failure.clash : undefined;

  function runMove(allowOverlap: boolean) {
    void move.run({ bookingId: booking.id, date: moveDate, time: moveTime, allowOverlap });
  }

  const cancelled = booking.status === 'cancelled';
  const live = booking.status === 'pending' || booking.status === 'confirmed';

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        closeLabel={t('a.close')}
        title={
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: colourHex(booking.service.colour) }}
            />
            {booking.customer.name}
          </span>
        }
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('a.done')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          {flash ? <Banner tone="success">{flash}</Banner> : null}

          {booking.needsAttention ? (
            <Banner
              tone="warn"
              title={t('day.needsAttention')}
              actions={
                <Button size="sm" variant="secondary" loading={seen.pending} onClick={() => void seen.run(booking.id)}>
                  {t('bk.markSeen')}
                </Button>
              }
            >
              {seen.error ? <span className="text-danger">{seen.error}</span> : null}
            </Banner>
          ) : null}

          {booking.outsideHours ? (
            <Banner tone="info" title={t('day.outsideHours')}>
              {t('day.outsideHoursHint')}
            </Banner>
          ) : null}

          {booking.customer.blocked ? (
            <Banner tone="warn">{t('cus.blockedHint')}</Banner>
          ) : null}

          {/* ── The facts ─────────────────────────────────────────────────── */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{t('bk.when')}</dt>
            <dd className="flex flex-wrap items-center gap-2 text-ink">
              <span>{booking.whenLabel}</span>
              <span className="text-muted">{booking.timeRange}</span>
            </dd>

            <dt className="text-muted">{t('bk.service')}</dt>
            <dd className="text-ink">
              {booking.service.name} · {booking.service.durationLabel}
            </dd>

            <dt className="text-muted">{t('bk.price')}</dt>
            <dd className="text-ink">{booking.priceLabel}</dd>

            <dt className="text-muted">{t('bk.customer')}</dt>
            <dd className="text-ink">{booking.customer.phoneLabel}</dd>

            <dt className="text-muted">{t('bk.status')}</dt>
            <dd>
              <StatusPill variant={booking.status}>{t(`status.${booking.status}`)}</StatusPill>
            </dd>
          </dl>

          <p className="text-sm text-muted">
            {t(booking.source === 'admin' ? 'day.bookedBy.admin' : 'day.bookedBy.customer')}
          </p>

          {/* ── Reaching the customer ─────────────────────────────────────── */}
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <a
              href={telHref(booking.customer.phone)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line px-4 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
            >
              <Icon name="phone" size={18} />
              {t('day.call')}
            </a>

            {/* Keyed on the status so that cancelling re-seeds the composer with the
                cancellation wording — which is exactly the message she needs next. */}
            <WhatsAppComposer
              key={booking.status}
              booking={booking}
              defaultKind={cancelled ? 'cancelled' : 'about'}
            />
          </section>

          {/* ── Confirming a pending booking ──────────────────────────────── */}
          {booking.status === 'pending' ? (
            <section className="border-t border-line pt-4">
              <Button loading={confirm.pending} onClick={() => void confirm.run(booking.id)}>
                {t('bk.confirmBooking')}
              </Button>
              {confirm.error ? (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {confirm.error}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* ── Moving ────────────────────────────────────────────────────── */}
          {live ? (
            <section className="flex flex-col gap-3 border-t border-line pt-4">
              <h3 className="font-display text-base font-semibold text-ink">{t('bk.moveTitle')}</h3>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t('bk.date')}
                  type="date"
                  value={moveDate}
                  onChange={(event) => setMoveDate(event.target.value)}
                  error={move.fieldError('date')}
                />
                <Field
                  label={t('bk.time')}
                  type="time"
                  value={moveTime}
                  onChange={(event) => setMoveTime(event.target.value)}
                  error={move.fieldError('time')}
                />
              </div>

              {clash ? (
                <Banner
                  tone="warn"
                  title={t('clash.title')}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={move.pending}
                        onClick={() => runMove(true)}
                      >
                        {t('clash.overrideMove')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={move.reset}>
                        {t('clash.pick')}
                      </Button>
                    </>
                  }
                >
                  {interpolate(t('clash.body'), {
                    when: clash.when,
                    name: clash.customerName,
                    service: clash.serviceName,
                  })}
                </Banner>
              ) : null}

              {move.error && !clash ? (
                <p role="alert" className="text-sm text-danger">
                  {move.error}
                </p>
              ) : null}

              <Button variant="secondary" loading={move.pending} onClick={() => runMove(false)}>
                {t('bk.move')}
              </Button>
            </section>
          ) : null}

          {/* ── The owner's own note ──────────────────────────────────────── */}
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">{t('bk.note')}</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('bk.notePlaceholder')}
                rows={2}
                className="rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
              />
            </label>
            <div>
              <Button
                size="sm"
                variant="secondary"
                loading={saveNote.pending}
                onClick={() => void saveNote.run(booking.id, note)}
              >
                {t('bk.saveNote')}
              </Button>
            </div>
            {saveNote.error ? (
              <p role="alert" className="text-sm text-danger">
                {saveNote.error}
              </p>
            ) : null}
          </section>

          {/* ── Ending it ─────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <Link
              href={`/admin/customers/${booking.customer.id}`}
              className="text-sm text-blue no-underline hover:underline"
            >
              {t('bk.viewCustomer')}
            </Link>

            {live ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => setConfirming('cancel')}>
                  {t('bk.cancel')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!booking.finished}
                  onClick={() => setConfirming('no_show')}
                >
                  {t('bk.noShow')}
                </Button>
              </div>
            ) : null}

            {live && !booking.finished ? (
              <p className="text-sm text-muted">{t('bk.error.not_finished')}</p>
            ) : null}

            {cancel.error ? (
              <p role="alert" className="text-sm text-danger">
                {cancel.error}
              </p>
            ) : null}
            {noShow.error ? (
              <p role="alert" className="text-sm text-danger">
                {noShow.error}
              </p>
            ) : null}
          </section>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirming === 'cancel'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void cancel.run(booking.id)}
        title={t('bk.cancelTitle')}
        message={interpolate(t('bk.cancelMessage'), {
          name: booking.customer.name,
          when: booking.whenLabel,
        })}
        confirmLabel={t('bk.cancel')}
        cancelLabel={t('a.back')}
        closeLabel={t('a.close')}
        confirmPending={cancel.pending}
      />

      <ConfirmDialog
        open={confirming === 'no_show'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void noShow.run(booking.id)}
        title={t('bk.noShowTitle')}
        message={interpolate(t('bk.noShowMessage'), {
          name: booking.customer.name,
          when: booking.whenLabel,
        })}
        confirmLabel={t('bk.noShow')}
        cancelLabel={t('a.back')}
        closeLabel={t('a.close')}
        confirmPending={noShow.pending}
      />
    </>
  );
}
