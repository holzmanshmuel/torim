/**
 * Framework-agnostic core of `useAsyncAction`.
 *
 * The predecessor project's most-repeated bug: an async UI action with no
 * `try/catch/finally` left a button on "one moment..." forever, or a fetch with no
 * `.catch()` left a customer on "loading..." permanently. It was "fixed" once and
 * then found again in six more components. This module is the fix that can't be
 * un-fixed by accident: `run` always clears `pending` in a `finally`, a second
 * `run` while one is already in flight is ignored, and every thrown value becomes
 * a displayable string.
 *
 * Kept free of React on purpose: this repo's test runner (see vitest.config.mts)
 * only exercises plain `.test.ts` files, not rendered components, so the guarantees
 * that matter most live here, where they're directly unit-testable. `useAsyncAction`
 * (same directory) is a thin React binding on top.
 */

export type AsyncActionCallbacks = {
  /** Called synchronously, before the action starts. */
  onStart: () => void;
  /** Called when the action resolves. Skipped if the component has unmounted. */
  onSuccess: () => void;
  /** Called with a display-ready message when the action throws. Skipped if the
   *  component has unmounted. */
  onError: (message: string) => void;
  /** Always called in the action's `finally`, success or failure - but, like the
   *  others, skipped if the component has unmounted. */
  onSettle: () => void;
};

export type AsyncActionCore<Args extends unknown[], T> = {
  run: (...args: Args) => Promise<T | undefined>;
  /** Whether an invocation is currently in flight. Plain function, not React
   *  state - reading it is synchronous and always current. */
  isPending: () => boolean;
};

/**
 * Wraps `action` with the double-submit guard and the pending/error guarantees.
 * `toMessage` turns a thrown value into a string to hand to `onError`.
 * `isMounted` (defaults to always-mounted) gates the callbacks so nothing fires
 * after a caller has torn down whatever they were updating.
 */
export function createAsyncActionCore<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
  toMessage: (err: unknown) => string,
  callbacks: AsyncActionCallbacks,
  isMounted: () => boolean = () => true,
): AsyncActionCore<Args, T> {
  let pending = false;

  async function run(...args: Args): Promise<T | undefined> {
    // Double-submit guard: a plain closure variable, not React state, so it's
    // synchronously current even across rapid clicks before any re-render lands.
    if (pending) return undefined;
    pending = true;
    callbacks.onStart();

    try {
      const result = await action(...args);
      if (isMounted()) callbacks.onSuccess();
      return result;
    } catch (err) {
      if (isMounted()) callbacks.onError(toMessage(err));
      return undefined;
    } finally {
      // Cleared unconditionally, mounted or not - this is what makes "pending
      // forever" structurally impossible, independent of whether anyone is still
      // around to see the state.
      pending = false;
      if (isMounted()) callbacks.onSettle();
    }
  }

  return { run, isPending: () => pending };
}

/** Turns a thrown value into a string safe to show a user. Never leaks a raw
 *  stack trace or "[object Object]" - falls back to `fallback` for anything that
 *  isn't a non-empty `Error` message or a non-empty string. */
export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  return fallback;
}
