'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { toErrorMessage } from './asyncActionCore';

export type UseAsyncActionOptions = {
  /** Used only to resolve the localized fallback message (`error.title`) shown
   *  when a thrown value carries no usable text of its own. Defaults to 'en'. */
  lang?: Lang;
};

export type UseAsyncActionResult<Args extends unknown[], T> = {
  /**
   * Ignored while a previous call is still pending - no double-submit. Note:
   * `run`'s identity follows `action` (and `lang`) like any other `useCallback` -
   * pass a stable `action` (e.g. via your own `useCallback`) if you need `run`
   * itself to stay referentially stable across renders.
   */
  run: (...args: Args) => Promise<T | undefined>;
  pending: boolean;
  error: string | null;
  /** Clears `error` and `pending`. Does not cancel an in-flight `run`. */
  reset: () => void;
};

/**
 * The enforcement mechanism for this repo's most-repeated bug class: a server call
 * with no `try/catch/finally` leaving a button on "one moment..." forever, or a
 * fetch with no `.catch()` leaving a customer on "loading..." permanently.
 *
 * Wrap any async action in this hook and that shape of bug becomes structurally
 * impossible to write: `pending` always returns to `false` (success, failure, or
 * unmount) because it's cleared in a `finally`; a thrown value always becomes a
 * displayable, localized string in `error`; a second `run()` while one is already
 * in flight is ignored; and no state is set after the component has unmounted.
 *
 * The guard and error-formatting logic mirror `./asyncActionCore` (a
 * framework-free, directly unit-tested twin of the same guarantees - this repo's
 * test runner only exercises plain `.test.ts` files, not rendered components).
 * It's re-implemented inline here, rather than delegated to that module, because
 * this repo's `react-hooks/refs` lint rule forbids handing a closure that reads a
 * ref to another function while rendering; everything below that touches
 * `pendingRef`/`mountedRef` instead runs strictly inside the `useCallback`/
 * `useEffect` bodies below, i.e. only in response to a render having already
 * committed or the action actually being invoked - never during render itself.
 */
export function useAsyncAction<Args extends unknown[] = [], T = void>(
  action: (...args: Args) => Promise<T>,
  options: UseAsyncActionOptions = {},
): UseAsyncActionResult<Args, T> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Double-submit guard. A ref, not the `pending` state, because it must be
  // synchronously current the instant `run` is called again - React state updates
  // are not synchronous, so two rapid calls before a re-render would otherwise
  // both slip past a check against the `pending` state variable.
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lang = options.lang ?? 'en';

  const run = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      if (pendingRef.current) return undefined;
      pendingRef.current = true;
      setPending(true);
      setError(null);

      try {
        return await action(...args);
      } catch (err) {
        const message = toErrorMessage(err, getT(lang)('error.title'));
        if (mountedRef.current) setError(message);
        return undefined;
      } finally {
        // Cleared unconditionally, mounted or not - this is what makes "pending
        // forever" structurally impossible, independent of whether anyone is
        // still around to see the state.
        pendingRef.current = false;
        if (mountedRef.current) setPending(false);
      }
    },
    [action, lang],
  );

  const reset = useCallback(() => {
    setError(null);
    setPending(false);
    pendingRef.current = false;
  }, []);

  return { run, pending, error, reset };
}
