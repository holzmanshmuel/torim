import { describe, expect, it, vi } from 'vitest';
import { createAsyncActionCore, toErrorMessage } from './asyncActionCore';
import type { AsyncActionCallbacks } from './asyncActionCore';

function makeCallbacks(): AsyncActionCallbacks {
  return {
    onStart: vi.fn<() => void>(),
    onSuccess: vi.fn<() => void>(),
    onError: vi.fn<(message: string) => void>(),
    onSettle: vi.fn<() => void>(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createAsyncActionCore', () => {
  it('clears pending and calls onSuccess when the action resolves', async () => {
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(
      async (value: number) => value * 2,
      (err) => toErrorMessage(err, 'fallback'),
      callbacks,
    );

    const result = await core.run(21);

    expect(result).toBe(42);
    expect(core.isPending()).toBe(false);
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onSettle).toHaveBeenCalledTimes(1);
  });

  it('clears pending in finally and captures a localized error string when the action throws', async () => {
    // This is the exact bug useAsyncAction exists to make impossible: pending must
    // return to false even though the action below never resolves normally.
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(
      async () => {
        throw new Error('boom');
      },
      (err) => toErrorMessage(err, 'fallback'),
      callbacks,
    );

    const result = await core.run();

    expect(result).toBeUndefined();
    expect(core.isPending()).toBe(false);
    expect(callbacks.onError).toHaveBeenCalledWith('boom');
    expect(callbacks.onSettle).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it('falls back to the provided message when a throw carries no usable text', async () => {
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(
      async () => {
        throw new Error('');
      },
      (err) => toErrorMessage(err, 'Something went wrong'),
      callbacks,
    );

    await core.run();

    expect(callbacks.onError).toHaveBeenCalledWith('Something went wrong');
  });

  it('ignores a second run() while the first is still pending', async () => {
    const gate = deferred<number>();
    const action = vi.fn(() => gate.promise);
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(action, (err) => toErrorMessage(err, 'fallback'), callbacks);

    const first = core.run();
    expect(core.isPending()).toBe(true);

    const second = core.run();
    expect(action).toHaveBeenCalledTimes(1);

    gate.resolve(7);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(7);
    expect(secondResult).toBeUndefined();
    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    expect(core.isPending()).toBe(false);
  });

  it('allows a new run() once the previous one has settled', async () => {
    const action = vi.fn(async () => 'ok');
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(action, (err) => toErrorMessage(err, 'fallback'), callbacks);

    await core.run();
    await core.run();

    expect(action).toHaveBeenCalledTimes(2);
    expect(callbacks.onStart).toHaveBeenCalledTimes(2);
  });

  it('suppresses callbacks once unmounted but still clears the internal pending flag', async () => {
    let mounted = true;
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(
      async () => {
        mounted = false; // simulate the caller tearing down mid-flight
        return 'value';
      },
      (err) => toErrorMessage(err, 'fallback'),
      callbacks,
      () => mounted,
    );

    const result = await core.run();

    expect(result).toBe('value');
    expect(core.isPending()).toBe(false);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onSettle).not.toHaveBeenCalled();
  });

  it('suppresses onError after unmount too', async () => {
    let mounted = true;
    const callbacks = makeCallbacks();
    const core = createAsyncActionCore(
      async () => {
        mounted = false;
        throw new Error('too late');
      },
      (err) => toErrorMessage(err, 'fallback'),
      callbacks,
      () => mounted,
    );

    await core.run();

    expect(core.isPending()).toBe(false);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onSettle).not.toHaveBeenCalled();
  });
});

describe('toErrorMessage', () => {
  it('uses the Error message when present', () => {
    expect(toErrorMessage(new Error('bad input'), 'fallback')).toBe('bad input');
  });

  it('falls back for an Error with an empty message', () => {
    expect(toErrorMessage(new Error(''), 'fallback')).toBe('fallback');
  });

  it('falls back for an Error with a whitespace-only message', () => {
    expect(toErrorMessage(new Error('   '), 'fallback')).toBe('fallback');
  });

  it('uses a thrown string directly', () => {
    expect(toErrorMessage('nope', 'fallback')).toBe('nope');
  });

  it('falls back for an empty thrown string', () => {
    expect(toErrorMessage('', 'fallback')).toBe('fallback');
  });

  it('falls back for non-Error, non-string throws', () => {
    expect(toErrorMessage({ code: 500 }, 'fallback')).toBe('fallback');
    expect(toErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(toErrorMessage(42, 'fallback')).toBe('fallback');
  });
});
