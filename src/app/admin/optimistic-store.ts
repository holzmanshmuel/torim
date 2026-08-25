/**
 * Optimistic booking state that survives unmount.
 *
 * This is a rewrite of a bug that took the predecessor project three attempts to kill.
 * The owner's most-repeated daily action — acknowledging a change, cancelling a
 * booking — visually reverted every single time despite having saved. The first fix
 * kept the optimistic value in component state, so a component unmount during a mode
 * switch threw it away. The second fix made the value permanent, which "fixed" the
 * revert and broke something worse: a change made on another device never appeared,
 * because the frozen local value won forever.
 *
 * So the store here is deliberately three things at once:
 *
 *  1. **Module-level, not component state.** A row can unmount (a sheet closes, the day
 *     list re-renders, a tab switches) and remount without losing the pending value.
 *  2. **Self-settling.** Each hold records the value it *expects* the server to reach
 *     and the value it *replaced*. A hold survives only while the server still reports
 *     the old value. The moment the server agrees — or reports something different
 *     because another device moved it — the hold is gone and the server wins.
 *  3. **Time-bounded.** Even if no server update ever arrives, a hold expires. A stuck
 *     optimistic value is a lie about saved data, and a lie with a deadline is the most
 *     a client is entitled to tell.
 *
 * Framework-free on purpose: this repo's vitest run only exercises plain `.test.ts`
 * files, so the rules that matter — including the unmount/remount one — are provable
 * here rather than in a component test that cannot run.
 */

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show';

/** The only two fields the admin UI ever shows ahead of the server. */
export type BookingState = {
  status: BookingStatus;
  needsAttention: boolean;
};

export type BookingPatch = Partial<BookingState>;

type FieldName = keyof BookingState;

const FIELDS: readonly FieldName[] = ['status', 'needsAttention'];

type Hold = {
  /** What the server is expected to report once the write lands. */
  expected: BookingState[FieldName];
  /** What the server reported when the hold was taken. */
  base: BookingState[FieldName];
  /** When the hold was taken, for the expiry bound. */
  at: number;
};

type Entry = Partial<Record<FieldName, Hold>>;

/**
 * One minute. Long enough to cover a slow write plus the router refresh behind it,
 * short enough that a hold nobody ever settles cannot outlive the owner's attention.
 */
export const DEFAULT_TTL_MS = 60_000;

export type OptimisticStore = {
  /** Record an optimistic value. `base` is the server state it is being applied over. */
  apply: (id: string, base: BookingState, patch: BookingPatch, at?: number) => void;
  /** The state to render. Pure — safe to call during a React render. */
  resolve: (id: string, server: BookingState, at?: number) => BookingState;
  /** Whether this booking currently has an unsettled optimistic value. */
  isPending: (id: string, server: BookingState, at?: number) => boolean;
  /**
   * Drop every hold the given server states have settled or invalidated, and every hold
   * past its expiry. Returns true when something changed (and notifies subscribers).
   * Call from an effect, never during render.
   */
  prune: (servers: Iterable<readonly [string, BookingState]>, at?: number) => boolean;
  /** Forget one booking's holds outright, e.g. after it is deleted. */
  forget: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
  /** Monotonic counter — the snapshot value for `useSyncExternalStore`. */
  getVersion: () => number;
  /** Test seams. */
  reset: () => void;
  size: () => number;
};

export function createOptimisticStore(options: {
  ttlMs?: number;
  now?: () => number;
} = {}): OptimisticStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const clock = options.now ?? (() => Date.now());

  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let version = 0;

  function bump(): void {
    version += 1;
    // Copied before iterating: a listener that unsubscribes itself while being notified
    // must not perturb the set mid-loop.
    for (const listener of [...listeners]) listener();
  }

  /** A hold is alive while the server still reports what it replaced, and not expired. */
  function alive(hold: Hold, serverValue: BookingState[FieldName], at: number): boolean {
    if (at - hold.at > ttlMs) return false;
    return serverValue === hold.base;
  }

  function apply(id: string, base: BookingState, patch: BookingPatch, at = clock()): void {
    const entry: Entry = { ...(entries.get(id) ?? {}) };
    let changed = false;

    for (const field of FIELDS) {
      const next = patch[field];
      if (next === undefined) continue;
      // A patch that asks for the value already showing is not worth holding: it would
      // settle on the very next resolve anyway, and holding it only risks masking a
      // concurrent change from another device.
      if (next === base[field]) {
        if (entry[field]) {
          delete entry[field];
          changed = true;
        }
        continue;
      }
      entry[field] = { expected: next, base: base[field], at };
      changed = true;
    }

    if (!changed) return;
    if (Object.keys(entry).length === 0) entries.delete(id);
    else entries.set(id, entry);
    bump();
  }

  function resolve(id: string, server: BookingState, at = clock()): BookingState {
    const entry = entries.get(id);
    if (!entry) return server;

    let result: BookingState | null = null;
    for (const field of FIELDS) {
      const hold = entry[field];
      if (!hold) continue;
      if (!alive(hold, server[field], at)) continue;
      result ??= { ...server };
      // The cast is confined to this one line: `Entry` is keyed by field name, so the
      // hold for `status` can only ever carry a status, but TypeScript cannot correlate
      // the two through a loop variable.
      (result as Record<FieldName, BookingState[FieldName]>)[field] = hold.expected;
    }
    return result ?? server;
  }

  function isPending(id: string, server: BookingState, at = clock()): boolean {
    const entry = entries.get(id);
    if (!entry) return false;
    return FIELDS.some((field) => {
      const hold = entry[field];
      return hold !== undefined && alive(hold, server[field], at);
    });
  }

  function prune(servers: Iterable<readonly [string, BookingState]>, at = clock()): boolean {
    let changed = false;

    for (const [id, server] of servers) {
      const entry = entries.get(id);
      if (!entry) continue;
      for (const field of FIELDS) {
        const hold = entry[field];
        if (!hold) continue;
        if (alive(hold, server[field], at)) continue;
        delete entry[field];
        changed = true;
      }
      if (Object.keys(entry).length === 0) entries.delete(id);
    }

    // Holds for bookings that were not in this batch still expire on time, so a row that
    // scrolls out of the list cannot leave a stale hold behind forever.
    for (const [id, entry] of entries) {
      for (const field of FIELDS) {
        const hold = entry[field];
        if (hold && at - hold.at > ttlMs) {
          delete entry[field];
          changed = true;
        }
      }
      if (Object.keys(entry).length === 0) entries.delete(id);
    }

    if (changed) bump();
    return changed;
  }

  function forget(id: string): void {
    if (entries.delete(id)) bump();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    apply,
    resolve,
    isPending,
    prune,
    forget,
    subscribe,
    getVersion: () => version,
    reset: () => {
      entries.clear();
      version = 0;
    },
    size: () => entries.size,
  };
}

/**
 * The one store the admin app uses. Module scope is the whole point: it outlives every
 * component that reads it, which is what makes an optimistic value survive a row
 * unmounting and remounting.
 */
export const bookingOptimism = createOptimisticStore();
