/**
 * Rate limits for the public (unauthenticated) booking endpoints.
 *
 * Every limiter is created once at module scope, because the sliding window has to
 * outlive a single request to mean anything.
 *
 * ⚠ The rejection copy matters as much as the limit. On the predecessor project a shared
 * office or household IP hitting the limit greyed out the whole calendar, which to the
 * customer is indistinguishable from "this business is closed all month" — nothing said
 * otherwise, so nobody reported it as a bug and people simply stopped booking. That is
 * why `createRateLimiter` returns `retryAfterMs`, why the dictionary string for a
 * rejection names a wait in minutes, and why it explicitly says the business is open.
 * Do not reuse a generic error string here.
 *
 * ⚠ In-process, so these are per instance (documented in SECURITY.md). Behind several
 * instances the effective limit multiplies by the instance count.
 */
import { createRateLimiter } from '@/lib/rate-limit';

/**
 * Reading availability. Generous: opening the page, flicking through three months and
 * changing service twice is a dozen calls in a minute from one honest customer.
 */
export const availabilityLimiter = createRateLimiter({ limit: 120, windowMs: 5 * 60_000 });

/**
 * Writing a booking, per IP. A salon's own front desk booking walk-ins from one address
 * is the honest high-water mark; anything past this is scripted.
 */
export const bookingIpLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });

/**
 * Writing a booking, per phone number. Independent of IP on purpose: the same number
 * hammered from a rotating pool of addresses is the abuse shape an IP limit alone
 * misses, and a real person books once or twice in an hour.
 */
export const bookingPhoneLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 });

/** Cancel/reschedule from a manage link, per IP. */
export const manageWriteLimiter = createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });

/** Downloading the .ics for a booking, per IP. */
export const icsLimiter = createRateLimiter({ limit: 60, windowMs: 15 * 60_000 });

/**
 * The client address, as far as it can be known.
 *
 * The left-most `x-forwarded-for` entry is the original client when a trusted proxy
 * appends to the header — which is the deployment shape Torim documents. It is
 * spoofable when nothing trusted sits in front, so this is a speed bump against casual
 * abuse, not an identity. Falling back to a single shared bucket is deliberate: an
 * unknown address must still be *limited*, not exempt.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
