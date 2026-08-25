/**
 * Sliding-window rate limiting for the public booking surface.
 *
 * v1 has no customer verification by design — name and phone, no account — so rate
 * limits and the owner's confirm-new-customers toggle carry the whole abuse load.
 *
 * The result deliberately carries `retryAfterMs`. A rejection has to be able to say
 * "too many attempts, try again in a minute". The predecessor project let a shared
 * household or office IP simply grey out the whole calendar, which is indistinguishable
 * from "this business is closed all month" — the customer has no idea anything is wrong.
 *
 * ⚠ In-process, so limits are per instance. Behind several instances the effective limit
 * multiplies by the instance count. Documented in SECURITY.md; a shared store is the fix
 * if Torim ever runs horizontally scaled.
 */
export type RateLimitResult = {
  allowed: boolean;
  /** Attempts still available in the current window. */
  remaining: number;
  /** How long until the next attempt would be allowed. 0 when allowed. */
  retryAfterMs: number;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  /**
   * Hard ceiling on tracked keys.
   *
   * Keys derive from request headers, so their number is attacker-influenced. Eviction
   * only runs once per window, which means a full window of distinct keys accumulates
   * first — measured at 293MB over 20k requests before the ceiling existed. The bound
   * makes the worst case arithmetic instead of a hope. Evicting the oldest costs an
   * attacker nothing they did not already have (a fresh key is a fresh bucket either
   * way), so nothing is weakened by it.
   */
  maxKeys?: number;
  /** Injectable clock, so tests never sleep. */
  now?: () => number;
};

export type RateLimiter = {
  check(key: string): RateLimitResult;
  reset(key?: string): void;
  /** Number of tracked keys. Exposed so the eviction behaviour is testable. */
  size(): number;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 20_000;
  const now = options.now ?? Date.now;

  if (limit < 1) throw new Error('limit must be at least 1');
  if (windowMs < 1) throw new Error('windowMs must be positive');

  const hits = new Map<string, number[]>();

  /** Drop keys whose every hit has aged out, so an attacker cannot grow the map. */
  function evictStale(cutoff: number): void {
    for (const [key, timestamps] of hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1]! <= cutoff) {
        hits.delete(key);
      }
    }
  }

  let lastEviction = now();

  return {
    check(key: string): RateLimitResult {
      const current = now();
      const cutoff = current - windowMs;

      // Sweep occasionally rather than on every call — this runs on a hot path.
      if (current - lastEviction >= windowMs) {
        evictStale(cutoff);
        lastEviction = current;
      }

      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

      if (recent.length >= limit) {
        hits.set(key, recent);
        const oldest = recent[0]!;
        return {
          allowed: false,
          remaining: 0,
          // When the oldest hit falls out of the window, a slot frees up.
          retryAfterMs: Math.max(1, oldest + windowMs - current),
        };
      }

      recent.push(current);
      hits.set(key, recent);

      // Map iterates in insertion order, so the first entries are the oldest.
      if (hits.size > maxKeys) {
        evictStale(cutoff);
        for (const oldest of hits.keys()) {
          if (hits.size <= maxKeys) break;
          if (oldest !== key) hits.delete(oldest);
        }
      }

      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
    },

    reset(key?: string): void {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    },

    size(): number {
      return hits.size;
    },
  };
}
