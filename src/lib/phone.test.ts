import { describe, expect, it } from 'vitest';
import { InvalidPhoneError, isE164, normalisePhone, waMeLink } from './phone';

describe('normalisePhone', () => {
  it('turns a local Israeli number into E.164 using the business calling code', () => {
    expect(normalisePhone('050-123-4567', '972')).toBe('+972501234567');
  });

  it('accepts spaces, dots, parentheses and dashes', () => {
    expect(normalisePhone('(050) 123.4567', '972')).toBe('+972501234567');
    expect(normalisePhone('+972 50 123 4567', '972')).toBe('+972501234567');
  });

  it('treats a 00 prefix as an international dialling prefix', () => {
    expect(normalisePhone('00972501234567', '972')).toBe('+972501234567');
  });

  it('keeps an explicit country code even when it differs from the default', () => {
    expect(normalisePhone('+1 555 010 0001', '972')).toBe('+15550100001');
  });

  it('is idempotent on an already-normalised number', () => {
    expect(normalisePhone('+972501234567', '972')).toBe('+972501234567');
  });

  /**
   * Customer names and phone numbers arrive from an unauthenticated form. Unstripped
   * bidi override characters would scramble the admin list and any exported calendar
   * feed, so they never reach the database.
   */
  it('strips bidi control characters before parsing', () => {
    expect(normalisePhone('‮050-123-4567‬', '972')).toBe('+972501234567');
  });

  it('rejects a number that is too short to be real', () => {
    expect(() => normalisePhone('12345', '972')).toThrow(InvalidPhoneError);
  });

  it('rejects letters and empty input', () => {
    expect(() => normalisePhone('call me', '972')).toThrow(InvalidPhoneError);
    expect(() => normalisePhone('   ', '972')).toThrow(InvalidPhoneError);
  });

  it('rejects a country code starting with zero', () => {
    expect(() => normalisePhone('+0123456789', '972')).toThrow(InvalidPhoneError);
  });

  it('refuses to guess when there is no country code and no default', () => {
    expect(() => normalisePhone('0501234567', '')).toThrow(InvalidPhoneError);
  });
});

describe('isE164', () => {
  it('matches exactly what the database CHECK constraint accepts', () => {
    expect(isE164('+972501234567')).toBe(true);
    expect(isE164('+15550100001')).toBe(true);
    expect(isE164('0501234567')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
    expect(isE164('+12345')).toBe(false);
  });
});

describe('waMeLink', () => {
  it('builds a wa.me link with the number stripped of its plus', () => {
    const link = waMeLink('+972501234567', 'Hi');
    expect(link.startsWith('https://wa.me/972501234567?text=')).toBe(true);
  });

  it('encodes the message, including Hebrew and newlines', () => {
    const link = waMeLink('+972501234567', 'שלום\nמחר ב-10:00');
    expect(link).not.toContain('\n');
    expect(decodeURIComponent(link.split('text=')[1]!)).toBe('שלום\nמחר ב-10:00');
  });

  it('rejects a number that is not E.164, rather than building a dead link', () => {
    expect(() => waMeLink('0501234567', 'Hi')).toThrow(InvalidPhoneError);
  });
});
