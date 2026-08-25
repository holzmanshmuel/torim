/**
 * The three ways optimistic state went wrong before, each pinned by a test.
 *
 * These are plain unit tests rather than rendered components because this repo's vitest
 * run only picks up `.test.ts` (see vitest.config.mts) — which is exactly why the rules
 * live in a framework-free store instead of inside a hook.
 */
import { describe, expect, it } from 'vitest';
import {
  createOptimisticStore,
  DEFAULT_TTL_MS,
  type BookingState,
} from './optimistic-store';

const CONFIRMED: BookingState = { status: 'confirmed', needsAttention: false };
const NEEDS: BookingState = { status: 'confirmed', needsAttention: true };
const CANCELLED: BookingState = { status: 'cancelled', needsAttention: false };

/** A clock a test drives by hand, so expiry is provable without waiting a minute. */
function fixedClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

describe('optimistic booking store', () => {
  it('shows the optimistic value before the server catches up', () => {
    const store = createOptimisticStore();
    store.apply('b1', NEEDS, { needsAttention: false });

    expect(store.resolve('b1', NEEDS)).toEqual({ status: 'confirmed', needsAttention: false });
    expect(store.isPending('b1', NEEDS)).toBe(true);
  });

  it('leaves untouched bookings exactly as the server reported them', () => {
    const store = createOptimisticStore();
    store.apply('b1', NEEDS, { needsAttention: false });

    // Same object identity back, not a copy — a list of hundreds of rows should not
    // allocate for the ones with nothing pending.
    expect(store.resolve('b2', NEEDS)).toBe(NEEDS);
  });

  /**
   * The bug this file exists for. The first fix kept the value in component state, so
   * unmounting the row during a mode switch dropped it and the UI snapped back.
   */
  it('survives unmount and remount', () => {
    const store = createOptimisticStore();

    // Mount: a row subscribes and optimistically clears its attention flag.
    const unsubscribeFirstMount = store.subscribe(() => {});
    store.apply('b1', NEEDS, { needsAttention: false });
    expect(store.resolve('b1', NEEDS).needsAttention).toBe(false);

    // Unmount: every subscriber goes away. The server has not caught up yet.
    unsubscribeFirstMount();
    expect(store.resolve('b1', NEEDS).needsAttention).toBe(false);

    // Remount: a brand-new component instance subscribes and must still see it.
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.resolve('b1', NEEDS).needsAttention).toBe(false);
    expect(store.isPending('b1', NEEDS)).toBe(true);
    expect(notified).toBe(0);
  });

  /**
   * The second fix froze the value permanently, so a change made on another device
   * never showed. A hold must let go the moment the server agrees.
   */
  it('lets go as soon as the server reports the expected value', () => {
    const store = createOptimisticStore();
    store.apply('b1', NEEDS, { needsAttention: false });

    // The refreshed page now reports the flag cleared: the hold has done its job.
    expect(store.resolve('b1', CONFIRMED)).toBe(CONFIRMED);

    const changed = store.prune([['b1', CONFIRMED]]);
    expect(changed).toBe(true);
    expect(store.size()).toBe(0);
  });

  it('yields to a change made somewhere else', () => {
    const store = createOptimisticStore();
    // She clears the flag here…
    store.apply('b1', NEEDS, { needsAttention: false });
    // …while another device cancels the booking outright. The server value for `status`
    // is not what the hold replaced, so the hold is void and the server wins.
    expect(store.resolve('b1', CANCELLED)).toBe(CANCELLED);
    store.prune([['b1', CANCELLED]]);
    expect(store.size()).toBe(0);
  });

  it('expires a hold nothing ever settles', () => {
    const clock = fixedClock();
    const store = createOptimisticStore({ now: clock.now });

    store.apply('b1', NEEDS, { needsAttention: false });
    expect(store.resolve('b1', NEEDS).needsAttention).toBe(false);

    clock.advance(DEFAULT_TTL_MS + 1);
    expect(store.resolve('b1', NEEDS)).toBe(NEEDS);
    expect(store.isPending('b1', NEEDS)).toBe(false);

    store.prune([]);
    expect(store.size()).toBe(0);
  });

  it('prunes expired holds for bookings that are not in the current list', () => {
    const clock = fixedClock();
    const store = createOptimisticStore({ now: clock.now });

    store.apply('scrolled-away', NEEDS, { needsAttention: false });
    clock.advance(DEFAULT_TTL_MS + 1);

    // The visible batch says nothing about this booking at all.
    expect(store.prune([['visible', CONFIRMED]])).toBe(true);
    expect(store.size()).toBe(0);
  });

  it('holds several fields on one booking independently', () => {
    const store = createOptimisticStore();
    store.apply('b1', NEEDS, { needsAttention: false, status: 'cancelled' });

    expect(store.resolve('b1', NEEDS)).toEqual({ status: 'cancelled', needsAttention: false });

    // The server confirms the cancellation but still reports the attention flag set.
    const partial: BookingState = { status: 'cancelled', needsAttention: true };
    expect(store.resolve('b1', partial)).toEqual({
      status: 'cancelled',
      needsAttention: false,
    });
    store.prune([['b1', partial]]);
    expect(store.resolve('b1', partial)).toEqual({ status: 'cancelled', needsAttention: false });
  });

  it('ignores a patch that asks for the value already showing', () => {
    const store = createOptimisticStore();
    store.apply('b1', CONFIRMED, { needsAttention: false });
    expect(store.size()).toBe(0);
    expect(store.isPending('b1', CONFIRMED)).toBe(false);
  });

  it('bumps the version and notifies subscribers on a real change', () => {
    const store = createOptimisticStore();
    let notified = 0;
    const stop = store.subscribe(() => {
      notified += 1;
    });

    const before = store.getVersion();
    store.apply('b1', NEEDS, { needsAttention: false });
    expect(store.getVersion()).toBeGreaterThan(before);
    expect(notified).toBe(1);

    // A patch asking for what is already showing, where nothing is held, changes
    // nothing — otherwise every list re-renders for no reason.
    store.apply('b2', CONFIRMED, { needsAttention: false });
    expect(notified).toBe(1);

    stop();
    store.apply('b3', NEEDS, { needsAttention: false });
    expect(notified).toBe(1);
  });

  it('survives a listener that unsubscribes itself while being notified', () => {
    const store = createOptimisticStore();
    const seen: string[] = [];
    const stopA = store.subscribe(() => {
      seen.push('a');
      stopA();
    });
    store.subscribe(() => seen.push('b'));

    expect(() => store.apply('b1', NEEDS, { needsAttention: false })).not.toThrow();
    expect(seen).toEqual(['a', 'b']);
  });

  it('forgets a booking outright', () => {
    const store = createOptimisticStore();
    store.apply('b1', NEEDS, { needsAttention: false });
    store.forget('b1');
    expect(store.resolve('b1', NEEDS)).toBe(NEEDS);
    expect(store.size()).toBe(0);
  });
});
