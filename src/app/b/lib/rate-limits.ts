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

/**
 * Loading a booking's manage page, per IP.
 *
 * Generous, because a customer legitimately reloads and navigates within it. Its job is
 * to bound unauthenticated work, not to defend a 244-bit token against guessing.
 */
export const manageReadLimiter = createRateLimiter({ limit: 120, windowMs: 15 * 60_000 });

/** Downloading the .ics for a booking, per IP. */
export const icsLimiter = createRateLimiter({ limit: 60, windowMs: 15 * 60_000 });

/**
 * How many proxies Torim sits behind. `TRUSTED_PROXY_HOPS`, default 1.
 *
 * 0 means "nothing trusted is in front" and the header is ignored entirely.
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

/** The longest an IPv6 address with an IPv4 tail can be. */
const MAX_ADDRESS_LENGTH = 45;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
/** Deliberately loose on IPv6 grammar, strict on the alphabet and the length. */
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;

function asAddress(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > MAX_ADDRESS_LENGTH) return null;
  if (IPV4.test(candidate)) return candidate;
  if (candidate.includes(':') && IPV6.test(candidate)) return candidate;
  return null;
}

/**
 * The client address, as far as it can be known.
 *
 * Counted from the RIGHT, not the left. Each proxy appends what it saw, so the
 * right-most entries are the ones added by infrastructure and the left-most is whatever
 * the client chose to send. nginx's canonical `proxy_add_x_forwarded_for` appends —
 * meaning the left-most value is attacker-supplied, and keying on it turns every limit
 * here into a suggestion.
 *
 * The value must also parse as an IP address. That is not cosmetic: this string becomes
 * a map key in the limiter, and an unbounded header meant ~15KB of junk per request
 * bought ~15KB of retained heap until the next sweep.
 *
 * Falling back to one shared bucket is deliberate — an unknown address must still be
 * limited, not exempt. A deployment with nothing in front therefore shares a single
 * bucket across all its traffic; see the deployment note in SECURITY.md.
 */
export function clientAddress(
  headers: Headers,
  options: { trustedProxyHops?: number } = {},
): string {
  const hops = options.trustedProxyHops ?? trustedProxyHops();

  if (hops > 0) {
    const chain = (headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    // The entry the outermost trusted proxy observed.
    const index = chain.length - hops;
    const observed = index >= 0 ? asAddress(chain[index]) : null;
    if (observed) return observed;

    const realIp = asAddress(headers.get('x-real-ip') ?? undefined);
    if (realIp) return realIp;
  }

  return 'unknown';
}
