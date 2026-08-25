'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, StatusPill, cx, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { markAllSeenAction, markSeenAction } from '../_actions/bookings';
import { adminDictionary } from '../dictionary';
import { countLabel } from '../format';
import { bookingOptimism } from '../optimistic-store';
import type { BookingView } from '../types';
import { Banner } from './Banner';
import { useAdminAction } from './useAdminAction';
import { useOptimisticBookings } from './useOptimisticBookings';

/**
 * What customers changed since the owner last looked.
 *
 * This list is the only channel by which she learns a customer cancelled — messaging is
 * owner-initiated, so nothing arrives to tell her. It replaced a nightly digest that
 * lost every cancellation landing between the evening run and midnight.
 *
 * Acknowledging is optimistic and the row *dims* rather than vanishing: a row that
 * disappears the instant it is tapped gives no chance to read what it said. The server
 * refresh behind the tap removes it on the next render, and the optimistic value
 * survives that render either way — see `../optimistic-store`.
 */
export function ChangesList({ bookings }: { bookings: BookingView[] }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);
  const list = useOptimisticBookings(bookings);
  const [flash, setFlash] = useState<string | null>(null);

  const clearAll = useAdminAction(markAllSeenAction, {
    lang,
    onSuccess: (count) => {
      for (const booking of list) {
        bookingOptimism.apply(
          booking.id,
          { status: booking.status, needsAttention: booking.needsAttention },
          { needsAttention: false },
        );
      }
      setFlash(
        countLabel(count, t, { one: 'chg.cleared.one', many: 'chg.cleared.many' }),
      );
    },
  });

  return (
    <div className="flex flex-col gap-4">
      {flash ? <Banner tone="success">{flash}</Banner> : null}

      {clearAll.error ? (
        <p role="alert" className="text-sm text-danger">
          {clearAll.error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          loading={clearAll.pending}
          onClick={() => void clearAll.run()}
        >
          {t('chg.markAll')}
        </Button>
      </div>

      <ul className="flex flex-col gap-3">
        {list.map((booking) => (
          <ChangeRow key={booking.id} booking={booking} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One row, with its OWN action instance.
 *
 * That matters: `useAsyncAction`'s double-submit guard ignores a second call while one
 * is in flight, so a single shared instance would silently drop the second and third
 * row the owner taps while the first is still saving — and would spin every button at
 * once. One hook per row makes each tap independent.
 */
function ChangeRow({ booking }: { booking: BookingView }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const seen = useAdminAction(markSeenAction, {
    lang,
    onSuccess: () =>
      bookingOptimism.apply(
        booking.id,
        { status: booking.status, needsAttention: booking.needsAttention },
        { needsAttention: false },
      ),
  });

  const acknowledged = !booking.needsAttention;

  return (
    <li
      className={cx(
        'rounded-md border bg-surface px-4 py-3 shadow-soft transition-opacity',
        acknowledged ? 'border-line opacity-50' : 'border-warn',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono-label text-ink">{booking.timeRange}</span>
        <StatusPill variant={booking.status}>{t(`status.${booking.status}`)}</StatusPill>
      </div>

      <p className="mt-1 font-medium text-ink">{booking.customer.name}</p>
      <p className="text-sm text-body">
        {booking.whenLabel} · {booking.service.name}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={acknowledged}
          loading={seen.pending}
          onClick={() => void seen.run(booking.id)}
        >
          {acknowledged ? t('a.done') : t('chg.markSeen')}
        </Button>
        <Link
          href={`/admin?date=${booking.dateKey}`}
          className="text-sm text-blue no-underline hover:underline"
        >
          {t('chg.open')}
        </Link>
      </div>

      {seen.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {seen.error}
        </p>
      ) : null}
    </li>
  );
}
