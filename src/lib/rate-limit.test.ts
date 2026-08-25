import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

/** A clock the test drives, so no test ever sleeps. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: clock.now });

    expect(limiter.check('ip:1.2.3.4').allowed).toBe(true);
    expect(limiter.check('ip:1.2.3.4').allowed).toBe(true);
    expect(limiter.check('ip:1.2.3.4').allowed).toBe(true);
  });

  it('blocks the one after the limit', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now });

    limiter.check('k');
    limiter.check('k');
    expect(limiter.check('k').allowed).toBe(false);
  });

  it('reports how long to wait, so the UI can say so explicitly', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    limiter.check('k');
    clock.advance(10_000);
    const blocked = limiter.check('k');

    expect(blocked.allowed).toBe(false);
    // The first hit ages out 60s after it happened, i.e. 50s from now.
    expect(blocked.retryAfterMs).toBe(50_000);
  });

  it('reports remaining allowance while still under the limit', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: clock.now });

    expect(limiter.check('k').remaining).toBe(2);
    expect(limiter.check('k').remaining).toBe(1);
    expect(limiter.check('k').remaining).toBe(0);
  });

  it('lets the window slide rather than resetting in fixed blocks', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now });

    limiter.check('k');
    clock.advance(30_000);
    limiter.check('k');
    expect(limiter.check('k').allowed).toBe(false);

    // The first hit ages out at t+60s; one slot frees up, not both.
    clock.advance(30_001);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(false);
  });

  it('keeps different keys independent', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });

    expect(limiter.check('ip:1.1.1.1').allowed).toBe(true);
    expect(limiter.check('ip:2.2.2.2').allowed).toBe(true);
    expect(limiter.check('ip:1.1.1.1').allowed).toBe(false);
  });

  it('does not grow without bound as keys age out', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 5, windowMs: 1_000, now: clock.now });

    for (let i = 0; i < 500; i += 1) limiter.check(`key-${i}`);
    expect(limiter.size()).toBe(500);

    clock.advance(2_000);
    limiter.check('something-new');
    expect(limiter.size()).toBeLessThan(10);
  });

  it('never reports a negative wait', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: clock.now });
    limiter.check('k');
    const r = limiter.check('k');
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });
});
