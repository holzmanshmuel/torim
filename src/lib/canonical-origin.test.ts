import { describe, expect, it } from 'vitest';
import { allowedServerActionHosts } from './canonical-origin';

describe('allowedServerActionHosts', () => {
  it('returns the host of the configured public origin', () => {
    expect(allowedServerActionHosts('https://torim.example.com')).toEqual([
      'torim.example.com',
    ]);
  });

  /**
   * A trailing slash is the single most common way APP_BASE_URL gets written, and
   * it changes nothing about which host the browser will send in Origin.
   */
  it('ignores a trailing slash and any path', () => {
    expect(allowedServerActionHosts('https://torim.example.com/')).toEqual([
      'torim.example.com',
    ]);
    expect(allowedServerActionHosts('https://torim.example.com/b/demo')).toEqual([
      'torim.example.com',
    ]);
  });

  /**
   * The comparison Next.js makes is against the Host header, which carries the port
   * whenever it is not the scheme's default. Dropping it here would silently fail to
   * allow a development or LAN deployment served on a non-standard port.
   */
  it('keeps a non-default port, because Host carries it', () => {
    expect(allowedServerActionHosts('http://localhost:3000')).toEqual([
      'localhost:3000',
    ]);
  });

  it('drops the default port for the scheme, because Host omits it', () => {
    expect(allowedServerActionHosts('https://torim.example.com:443')).toEqual([
      'torim.example.com',
    ]);
  });

  /**
   * Unset is the ordinary single-origin case: Next.js already allows same-origin
   * requests on its own, so there is nothing extra to permit and an empty list is
   * the honest answer — not an error.
   */
  it('returns nothing when the public origin is unset or blank', () => {
    expect(allowedServerActionHosts(undefined)).toEqual([]);
    expect(allowedServerActionHosts('')).toEqual([]);
    expect(allowedServerActionHosts('   ')).toEqual([]);
  });

  /**
   * A value that is set but unparseable is a different situation entirely, and it
   * must not degrade into the empty list. Behind a Host-rewriting proxy an empty
   * allowlist means every Server Action in the app is rejected as cross-origin —
   * the whole product breaks, at runtime, on a mutation, with a generic client-side
   * error and nothing in the server log. Refusing to start is the kinder failure.
   */
  it('throws on a value that is set but not a URL', () => {
    expect(() => allowedServerActionHosts('torim.example.com')).toThrow(
      /APP_BASE_URL/,
    );
    expect(() => allowedServerActionHosts('not a url at all')).toThrow(/APP_BASE_URL/);
  });
});
