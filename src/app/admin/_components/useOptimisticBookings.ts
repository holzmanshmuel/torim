'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { bookingOptimism } from '../optimistic-store';
import type { BookingView } from '../types';

/**
 * Server-rendered bookings with any unsettled optimistic value laid over the top.
 *
 * The store lives at module scope (see `../optimistic-store`), so a row that unmounts —
 * a sheet closing, a tab switching, a list re-rendering — and then remounts still shows
 * what the owner just did. The store settles itself against fresh server data, so this
 * cannot freeze a stale value the way the predecessor's second fix did.
 *
 * `getServerSnapshot` returns a sentinel rather than the live version, so server render
 * and hydration agree exactly: optimistic values are applied on the very next client
 * render, never inside the hydration pass, and there is no mismatch to warn about.
 */
const HYDRATING = -1;

export function useOptimisticBookings(bookings: readonly BookingView[]): BookingView[] {
  const version = useSyncExternalStore(
    bookingOptimism.subscribe,
    bookingOptimism.getVersion,
    () => HYDRATING,
  );

  // Settle anything the freshly-arrived server data has confirmed or overtaken. In an
  // effect, never during render: `prune` mutates the store and notifies.
  useEffect(() => {
    bookingOptimism.prune(
      bookings.map(
        (booking) =>
          [booking.id, { status: booking.status, needsAttention: booking.needsAttention }] as const,
      ),
    );
  }, [bookings]);

  return useMemo(() => {
    if (version === HYDRATING) return [...bookings];

    return bookings.map((booking) => {
      const resolved = bookingOptimism.resolve(booking.id, {
        status: booking.status,
        needsAttention: booking.needsAttention,
      });
      if (resolved.status === booking.status && resolved.needsAttention === booking.needsAttention) {
        return booking;
      }
      return { ...booking, status: resolved.status, needsAttention: resolved.needsAttention };
    });
  }, [bookings, version]);
}
