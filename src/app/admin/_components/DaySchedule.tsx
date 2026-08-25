'use client';

import { useState } from 'react';
import { OpenWhatsApp, StatusPill, cx, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { colourHex } from '../colours';
import { adminDictionary } from '../dictionary';
import { telHref } from '../format';
import type { BookingView } from '../types';
import { BookingDetailSheet } from './BookingDetailSheet';
import { Icon } from './Icon';
import { useOptimisticBookings } from './useOptimisticBookings';

/**
 * The ordered list of a day's appointments — the screen this whole product is for.
 *
 * It renders **everything** `listBookingsForDay` returns, including appointments outside
 * opening hours, on closed days, and cancellations. The predecessor filtered this list
 * through the public booking window, so a 07:30 booking the owner had entered herself
 * simply did not exist on screen. Being outside hours is a badge here, never a filter.
 *
 * Tapping a row opens the detail sheet; call and WhatsApp sit outside that tap target as
 * their own controls, so reaching a customer is one tap from the list rather than three.
 */
export function DaySchedule({
  bookings,
  compact = false,
}: {
  bookings: BookingView[];
  compact?: boolean;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const list = useOptimisticBookings(bookings);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Kept so the sheet can stay open — and keep showing its confirmation — even after a
  // move takes the appointment off the day currently on screen.
  const [snapshot, setSnapshot] = useState<BookingView | null>(null);
  const selected = selectedId ? (list.find((item) => item.id === selectedId) ?? snapshot) : null;

  function open(booking: BookingView) {
    setSelectedId(booking.id);
    setSnapshot(booking);
  }

  function close() {
    setSelectedId(null);
    setSnapshot(null);
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {list.map((booking) => {
          const past = booking.status === 'cancelled' || booking.status === 'no_show';

          return (
            <li
              key={booking.id}
              className={cx(
                'overflow-hidden rounded-md border bg-surface shadow-soft',
                booking.needsAttention ? 'border-warn' : 'border-line',
              )}
            >
              <button
                type="button"
                onClick={() => open(booking)}
                aria-label={t('day.openBooking')}
                className="flex w-full items-stretch gap-3 px-3 py-3 text-start"
              >
                <span
                  aria-hidden="true"
                  className={cx('w-1.5 shrink-0 rounded-full', past && 'opacity-40')}
                  style={{ backgroundColor: colourHex(booking.service.colour) }}
                />

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cx(
                        'mono-label text-ink',
                        past && 'text-muted line-through',
                      )}
                    >
                      {booking.timeRange}
                    </span>
                    <StatusPill variant={booking.status}>
                      {t(`status.${booking.status}`)}
                    </StatusPill>
                    {booking.needsAttention ? (
                      <span className="mono-label inline-flex items-center gap-1 rounded-sm bg-warn-soft px-2 py-1 text-warn">
                        <Icon name="alert" size={12} />
                        {t('day.needsAttention')}
                      </span>
                    ) : null}
                  </span>

                  <span className={cx('font-medium text-ink', past && 'text-body')}>
                    {booking.customer.name}
                  </span>

                  <span className="text-sm text-body">
                    {booking.service.name} · {booking.priceLabel}
                  </span>

                  {booking.outsideHours ? (
                    <span className="text-sm text-warn">{t('day.outsideHours')}</span>
                  ) : null}

                  {!compact && booking.note ? (
                    <span className="text-sm text-muted">{booking.note}</span>
                  ) : null}
                </span>
              </button>

              {/* The week view sets `compact`: seven days of contact bars is unscannable,
                  and both actions are one tap away inside the detail sheet. */}
              {compact ? null : (
                <div className="flex items-stretch gap-px border-t border-line bg-line-2">
                  <a
                    href={telHref(booking.customer.phone)}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 bg-surface text-sm font-medium text-body no-underline hover:text-blue"
                  >
                    <Icon name="phone" size={16} />
                    {t('day.call')}
                  </a>
                  <div className="flex-1 bg-surface">
                    <OpenWhatsApp
                      phone={booking.customer.phone}
                      message={booking.whatsappMessages.about}
                      label={t('day.whatsapp')}
                      lang={lang}
                      variant="ghost"
                      className="w-full rounded-none"
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {selected ? (
        <BookingDetailSheet key={selected.id} booking={selected} onClose={close} />
      ) : null}
    </>
  );
}
