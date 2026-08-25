'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from '@/app/components';
import type { Lang } from '@/lib/i18n';
import type { ActionErr, ActionResult } from '../types';

export type UseAdminActionResult<Args extends unknown[], T> = {
  run: (...args: Args) => Promise<ActionResult<T> | undefined>;
  pending: boolean;
  /** Whatever should be shown to the owner right now — domain failure or thrown error. */
  error: string | null;
  /** The structured failure, for attaching a message to a field or branching on a clash. */
  failure: ActionErr | null;
  /** The message for one field, or undefined — pass straight to `Field`'s `error`. */
  fieldError: (field: string) => string | undefined;
  reset: () => void;
};

/**
 * `useAsyncAction` plus this app's action result shape.
 *
 * `useAsyncAction` already makes "stuck on one moment forever" structurally impossible —
 * `pending` clears in a `finally`, a second call while one is in flight is ignored, and
 * nothing is set after unmount. What it cannot do is understand a *returned* failure:
 * admin actions deliberately return `{ ok: false, code, message, field }` rather than
 * throwing, so a conflict can be branched on and a validation message can be pinned to
 * the field it belongs to. This keeps both channels and surfaces whichever fired.
 *
 * It also refreshes the route on success. Every admin action calls `refresh()` on the
 * server too; doing it here as well is deliberate belt-and-braces, because most of these
 * screens (services, hours, a customer profile) have no optimistic layer at all — if the
 * refreshed data never arrived, a save that worked perfectly would look like a button
 * that did nothing, which is the same bug as a stuck spinner wearing a different coat.
 *
 * Every async action in this lane goes through here. That is the enforcement: there is
 * no second way to call one.
 */
export function useAdminAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<ActionResult<T>>,
  options: { lang: Lang; onSuccess?: (value: T) => void },
): UseAdminActionResult<Args, T> {
  const [failure, setFailure] = useState<ActionErr | null>(null);
  const router = useRouter();

  const { run, pending, error, reset } = useAsyncAction<Args, ActionResult<T>>(
    async (...args: Args) => {
      setFailure(null);
      const result = await action(...args);
      if (!result.ok) {
        setFailure(result);
        return result;
      }
      // Optimistic patches are applied by `onSuccess` first, so the refresh that lands
      // straight after is what settles them.
      options.onSuccess?.(result.value);
      router.refresh();
      return result;
    },
    { lang: options.lang },
  );

  const resetAll = useCallback(() => {
    setFailure(null);
    reset();
  }, [reset]);

  const fieldError = useCallback(
    (field: string) => (failure?.field === field ? failure.message : undefined),
    [failure],
  );

  return {
    run,
    pending,
    // A thrown error wins: it means something failed outside the action's own reporting.
    error: error ?? failure?.message ?? null,
    failure,
    fieldError,
    reset: resetAll,
  };
}
