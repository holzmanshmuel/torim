import { describe, expect, it } from 'vitest';
import { allowedHosts } from './canonical-origin';

/**
 * With only APP_BASE_URL set — the shape every existing deployment has — the answer
 * must be exactly what it was before SERVER_ACTIONS_ALLOWED_ORIGINS existed. Every
 * case in this block is a case the original single-variable version was tested on.
 */
describe('allowedHosts — APP_BASE_URL alone', () => {
  it('returns the host of the configured public origin', () => {
    expect(allowedHosts({ APP_BASE_URL: 'https://torim.example.com' })).toEqual([
      'torim.example.com',
    ]);
  });

  /**
   * A trailing slash is the single most common way APP_BASE_URL gets written, and
   * it changes nothing about which host the browser will send in Origin.
   */
  it('ignores a trailing slash and any path', () => {
    expect(allowedHosts({ APP_BASE_URL: 'https://torim.example.com/' })).toEqual([
      'torim.example.com',
    ]);
    expect(allowedHosts({ APP_BASE_URL: 'https://torim.example.com/b/demo' })).toEqual([
      'torim.example.com',
    ]);
  });

  /**
   * The comparison Next.js makes is against the Host header, which carries the port
   * whenever it is not the scheme's default. Dropping it here would silently fail to
   * allow a development or LAN deployment served on a non-standard port.
   */
  it('keeps a non-default port, because Host carries it', () => {
    expect(allowedHosts({ APP_BASE_URL: 'http://localhost:3000' })).toEqual([
      'localhost:3000',
    ]);
  });

  it('drops the default port for the scheme, because Host omits it', () => {
    expect(allowedHosts({ APP_BASE_URL: 'https://torim.example.com:443' })).toEqual([
      'torim.example.com',
    ]);
  });

  /**
   * Unset is the ordinary single-origin case: Next.js already allows same-origin
   * requests on its own, so there is nothing extra to permit and an empty list is
   * the honest answer — not an error.
   */
  it('returns nothing when the public origin is unset or blank', () => {
    expect(allowedHosts({})).toEqual([]);
    expect(allowedHosts({ APP_BASE_URL: undefined })).toEqual([]);
    expect(allowedHosts({ APP_BASE_URL: '' })).toEqual([]);
    expect(allowedHosts({ APP_BASE_URL: '   ' })).toEqual([]);
  });

  /**
   * A value that is set but unparseable is a different situation entirely, and it
   * must not degrade into the empty list. Behind a Host-rewriting proxy an empty
   * allowlist means every Server Action in the app is rejected as cross-origin —
   * the whole product breaks, at runtime, on a mutation, with a generic client-side
   * error and nothing in the server log. Refusing to start is the kinder failure.
   */
  it('throws on a value that is set but not a URL', () => {
    expect(() => allowedHosts({ APP_BASE_URL: 'torim.example.com' })).toThrow(/APP_BASE_URL/);
    expect(() => allowedHosts({ APP_BASE_URL: 'not a url at all' })).toThrow(/APP_BASE_URL/);
  });
});

/**
 * A deployment answering on more than one hostname — the case that matters while a
 * service moves to a new domain and both names have to keep working.
 */
describe('allowedHosts — SERVER_ACTIONS_ALLOWED_ORIGINS', () => {
  it('adds every listed host after the host of APP_BASE_URL', () => {
    expect(
      allowedHosts({
        APP_BASE_URL: 'https://old.example.com',
        SERVER_ACTIONS_ALLOWED_ORIGINS: 'old.example.com,new.example.com',
      }),
    ).toEqual(['old.example.com', 'new.example.com']);
  });

  /**
   * APP_BASE_URL is always on the list, even when the extra variable forgets it — a
   * deployment must never stop accepting actions on its own public address because a
   * second setting was added.
   */
  it('always includes the host of APP_BASE_URL, even when the list omits it', () => {
    expect(
      allowedHosts({
        APP_BASE_URL: 'https://old.example.com',
        SERVER_ACTIONS_ALLOWED_ORIGINS: 'new.example.com',
      }),
    ).toEqual(['old.example.com', 'new.example.com']);
  });

  /**
   * An environment variable can be present but empty — a container ENV fed from a build
   * argument that was never passed, or a platform variable saved blank. That must mean
   * exactly what unset means, not an error and not a stray empty host.
   */
  it('treats an empty value exactly like an unset one', () => {
    expect(
      allowedHosts({ APP_BASE_URL: 'https://old.example.com', SERVER_ACTIONS_ALLOWED_ORIGINS: '' }),
    ).toEqual(allowedHosts({ APP_BASE_URL: 'https://old.example.com' }));
    expect(allowedHosts({ APP_BASE_URL: '', SERVER_ACTIONS_ALLOWED_ORIGINS: '' })).toEqual([]);
  });

  it('works on its own when APP_BASE_URL is unset', () => {
    expect(allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: 'new.example.com' })).toEqual([
      'new.example.com',
    ]);
  });

  it('takes a full origin as readily as a bare host, keeping only the host', () => {
    expect(
      allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: 'https://new.example.com/, http://localhost:3001' }),
    ).toEqual(['new.example.com', 'localhost:3001']);
  });

  it('normalises case and a default port, as the Host header would', () => {
    expect(allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: 'New.Example.COM:443' })).toEqual([
      'new.example.com',
    ]);
  });

  it('tolerates spaces and empty entries from a trailing or doubled comma', () => {
    expect(
      allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: ' a.example.com , ,b.example.com, ' }),
    ).toEqual(['a.example.com', 'b.example.com']);
    expect(allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: '' })).toEqual([]);
    expect(allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: ' , ' })).toEqual([]);
  });

  it('de-duplicates a host named by both variables', () => {
    expect(
      allowedHosts({
        APP_BASE_URL: 'https://torim.example.com/',
        SERVER_ACTIONS_ALLOWED_ORIGINS: 'torim.example.com,TORIM.example.com',
      }),
    ).toEqual(['torim.example.com']);
  });

  /**
   * The same reasoning as for APP_BASE_URL: quietly dropping a garbled entry leaves
   * that host rendering pages while every Server Action and every sign-in on it
   * fails. Refuse to start and name the variable instead.
   */
  it('throws on an entry that cannot be read as a host', () => {
    expect(() =>
      allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: 'good.example.com, not a host' }),
    ).toThrow(/SERVER_ACTIONS_ALLOWED_ORIGINS/);
    expect(() => allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: ':::' })).toThrow(
      /SERVER_ACTIONS_ALLOWED_ORIGINS/,
    );
    expect(() => allowedHosts({ SERVER_ACTIONS_ALLOWED_ORIGINS: 'https://' })).toThrow(
      /SERVER_ACTIONS_ALLOWED_ORIGINS/,
    );
  });
});
