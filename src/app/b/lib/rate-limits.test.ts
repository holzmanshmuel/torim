/**
 * Deriving a rate-limit key from request headers.
 *
 * Two separate failures live here, and both were found by red-teaming rather than by
 * review:
 *
 *  1. The left-most `x-forwarded-for` entry is *attacker-supplied*. nginx's canonical
 *     `proxy_add_x_forwarded_for` APPENDS the peer to whatever the client sent, so the
 *     left-most value is the client's own string. Keying on it makes every public limit
 *     a suggestion: send a fresh value per request and each one lands in a new bucket.
 *  2. The header is unbounded and its value became a map key, so ~15KB of junk per
 *     request bought ~15KB of retained heap. Measured at 293MB over 20k requests.
 *
 * Validating that the entry is actually an IP address closes both: it cannot be a
 * megabyte of junk, and combined with counting from the right it cannot be chosen.
 */
import { describe, expect, it } from 'vitest';
import { clientAddress } from './rate-limits';

const h = (headers: Record<string, string>) => new Headers(headers);

describe('clientAddress', () => {
  it('takes the entry the trusted proxy observed, not the one the client sent', () => {
    // Client spoofed "9.9.9.9"; the proxy appended what it actually saw.
    expect(
      clientAddress(h({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }), { trustedProxyHops: 1 }),
    ).toBe('203.0.113.7');
  });

  it('counts further right for a deeper proxy chain', () => {
    expect(
      clientAddress(h({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7, 10.0.0.1' }), {
        trustedProxyHops: 2,
      }),
    ).toBe('203.0.113.7');
  });

  it('rejects anything that is not an IP address', () => {
    const junk = 'A'.repeat(15_000);
    expect(clientAddress(h({ 'x-forwarded-for': junk }), { trustedProxyHops: 1 })).toBe('unknown');
    expect(
      clientAddress(h({ 'x-forwarded-for': 'not-an-ip' }), { trustedProxyHops: 1 }),
    ).toBe('unknown');
    expect(clientAddress(h({ 'x-forwarded-for': '999.1.1.1' }), { trustedProxyHops: 1 })).toBe(
      'unknown',
    );
  });

  it('never returns a key longer than an IP address can be', () => {
    const junk = `${'B'.repeat(20_000)}, 203.0.113.7`;
    const key = clientAddress(h({ 'x-forwarded-for': junk }), { trustedProxyHops: 1 });
    expect(key.length).toBeLessThanOrEqual(45);
  });

  it('accepts IPv6', () => {
    expect(
      clientAddress(h({ 'x-forwarded-for': '2001:db8::1' }), { trustedProxyHops: 1 }),
    ).toBe('2001:db8::1');
  });

  it('falls back to x-real-ip, still validated', () => {
    expect(clientAddress(h({ 'x-real-ip': '198.51.100.4' }), { trustedProxyHops: 1 })).toBe(
      '198.51.100.4',
    );
    expect(clientAddress(h({ 'x-real-ip': 'garbage' }), { trustedProxyHops: 1 })).toBe('unknown');
  });

  /**
   * A deployment with no proxy at all has no usable address, so everyone shares one
   * bucket. That is limited-but-shared rather than exempt, which is the safer of the two
   * wrong answers — and it is why the deployment note in SECURITY.md matters.
   */
  it('returns a single shared bucket when there is nothing to key on', () => {
    expect(clientAddress(new Headers(), { trustedProxyHops: 1 })).toBe('unknown');
  });

  it('with zero trusted hops, refuses to believe the header at all', () => {
    expect(
      clientAddress(h({ 'x-forwarded-for': '203.0.113.7' }), { trustedProxyHops: 0 }),
    ).toBe('unknown');
  });

  it('does not fall off the end of a short chain', () => {
    expect(
      clientAddress(h({ 'x-forwarded-for': '203.0.113.7' }), { trustedProxyHops: 3 }),
    ).toBe('unknown');
  });
});
