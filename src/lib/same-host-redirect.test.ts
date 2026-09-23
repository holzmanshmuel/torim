import { describe, expect, it } from 'vitest';
import { redirectToPath } from './same-host-redirect';

describe('redirectToPath', () => {
  /**
   * The point of the helper. A Route Handler's request.url names the host the server
   * listens on (for example https://localhost:8080 behind a platform router), so an
   * absolute Location built from it sends the browser off the site. A relative one
   * keeps the browser on whichever host it is on.
   */
  it('sends a relative Location, so the browser stays on its own host', () => {
    const response = redirectToPath('/admin');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/admin');
  });

  it('keeps a query string', () => {
    expect(redirectToPath('/login?error=state_missing').headers.get('location')).toBe(
      '/login?error=state_missing',
    );
  });

  it('can turn a POST into a GET with 303', () => {
    const response = redirectToPath('/login', 303);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });

  it('refuses anything that would leave the site', () => {
    for (const bad of [
      'https://evil.example.net/admin',
      '//evil.example.net/admin',
      '/\\evil.example.net',
      'admin',
      '',
      '/admin\r\nset-cookie: x=1',
    ]) {
      expect(() => redirectToPath(bad), JSON.stringify(bad)).toThrow(/same-origin path/);
    }
  });
});
