import { describe, expect, it } from 'vitest';
import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  parseDateKey,
  parseDateRange,
  parseEmail,
  parseInstant,
  parseManageToken,
  parseName,
  parseNote,
  parsePhoneInput,
  parseSlug,
  parseUuid,
  retryAfterMinutes,
} from './validate';

describe('parseDateKey', () => {
  it('accepts a real calendar day', () => {
    expect(parseDateKey('2026-08-27')).toBe('2026-08-27');
    expect(parseDateKey('2028-02-29')).toBe('2028-02-29'); // leap year
  });

  it('rejects a day that does not exist even though it is shaped like one', () => {
    // The whole reason this function exists: `2026-02-31` passes a regex and would
    // otherwise reach the database as a ::date cast.
    expect(parseDateKey('2026-02-31')).toBeNull();
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('2027-02-29')).toBeNull(); // not a leap year
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    expect(parseDateKey('2026-8-27')).toBeNull();
    expect(parseDateKey('2026-08-27T10:00:00Z')).toBeNull();
    expect(parseDateKey(' 2026-08-27')).toBeNull();
    expect(parseDateKey('')).toBeNull();
    expect(parseDateKey(null)).toBeNull();
    expect(parseDateKey(20260827)).toBeNull();
    expect(parseDateKey({ toString: () => '2026-08-27' })).toBeNull();
  });

  it('rejects years far outside any plausible booking', () => {
    expect(parseDateKey('1899-01-01')).toBeNull();
    expect(parseDateKey('2999-01-01')).toBeNull();
  });
});

describe('parseDateRange', () => {
  it('accepts an ordered range', () => {
    expect(parseDateRange('2026-08-01', '2026-08-31')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('accepts a single day', () => {
    expect(parseDateRange('2026-08-01', '2026-08-01')).toEqual({
      from: '2026-08-01',
      to: '2026-08-01',
    });
  });

  it('rejects an inverted range rather than swapping it', () => {
    expect(parseDateRange('2026-08-31', '2026-08-01')).toBeNull();
  });

  it('rejects a range wide enough to be a denial of service', () => {
    expect(parseDateRange('2026-01-01', '2030-01-01')).toBeNull();
  });

  it('honours a caller-supplied maximum', () => {
    expect(parseDateRange('2026-08-01', '2026-08-10', 5)).toBeNull();
    expect(parseDateRange('2026-08-01', '2026-08-05', 5)).not.toBeNull();
  });

  it('rejects when either end is not a real day', () => {
    expect(parseDateRange('2026-02-31', '2026-03-05')).toBeNull();
    expect(parseDateRange('2026-03-01', 'tomorrow')).toBeNull();
  });
});

describe('parseUuid', () => {
  it('accepts a canonical uuid and lowercases it', () => {
    expect(parseUuid('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
  });

  it('rejects anything else', () => {
    expect(parseUuid('not-a-uuid')).toBeNull();
    expect(parseUuid('3f2504e04f8911d39a0c0305e82c3301')).toBeNull();
    expect(parseUuid("' OR 1=1 --")).toBeNull();
    expect(parseUuid(undefined)).toBeNull();
  });
});

describe('parseSlug', () => {
  it('accepts ordinary slugs', () => {
    expect(parseSlug('demo')).toBe('demo');
    expect(parseSlug('lumen-beauty-studio')).toBe('lumen-beauty-studio');
    expect(parseSlug('DEMO')).toBe('demo');
  });

  it('rejects path traversal, spaces and edge hyphens', () => {
    expect(parseSlug('../admin')).toBeNull();
    expect(parseSlug('a b')).toBeNull();
    expect(parseSlug('-demo')).toBeNull();
    expect(parseSlug('demo-')).toBeNull();
    expect(parseSlug('')).toBeNull();
    expect(parseSlug('a'.repeat(64))).toBeNull();
  });
});

describe('parseManageToken', () => {
  const token = 'a'.repeat(64);

  it('accepts 64 lowercase hex characters', () => {
    expect(parseManageToken(token)).toBe(token);
  });

  it('rejects the wrong length, uppercase, and non-hex', () => {
    expect(parseManageToken('a'.repeat(63))).toBeNull();
    expect(parseManageToken('A'.repeat(64))).toBeNull();
    expect(parseManageToken('g'.repeat(64))).toBeNull();
    expect(parseManageToken(null)).toBeNull();
  });
});

describe('parseInstant', () => {
  it('accepts an ISO instant with an explicit offset', () => {
    expect(parseInstant('2026-08-27T07:00:00.000Z')?.toISOString()).toBe(
      '2026-08-27T07:00:00.000Z',
    );
    expect(parseInstant('2026-08-27T10:00:00+03:00')?.toISOString()).toBe(
      '2026-08-27T07:00:00.000Z',
    );
  });

  it('rejects a local time with no offset — it means a different instant to everyone', () => {
    expect(parseInstant('2026-08-27T10:00:00')).toBeNull();
    expect(parseInstant('2026-08-27')).toBeNull();
  });

  it('rejects nonsense and out-of-range years', () => {
    expect(parseInstant('not a date')).toBeNull();
    expect(parseInstant('2026-02-31T10:00:00Z')).toBeNull();
    expect(parseInstant('1970-01-01T00:00:00Z')).toBeNull();
    expect(parseInstant(1756278000000)).toBeNull();
  });
});

describe('parseName', () => {
  it('trims and accepts', () => {
    expect(parseName('  Dana Cohen ')).toBe('Dana Cohen');
    expect(parseName('דנה כהן')).toBe('דנה כהן');
  });

  it('rejects empty and over-long', () => {
    expect(parseName('   ')).toBeNull();
    expect(parseName('')).toBeNull();
    expect(parseName('x'.repeat(MAX_NAME_LENGTH + 1))).toBeNull();
    expect(parseName('x'.repeat(MAX_NAME_LENGTH))).not.toBeNull();
  });
});

describe('parseNote', () => {
  it('treats absent and blank alike', () => {
    expect(parseNote(undefined)).toEqual({ ok: true });
    expect(parseNote(null)).toEqual({ ok: true });
    expect(parseNote('   ')).toEqual({ ok: true });
  });

  it('trims a real note', () => {
    expect(parseNote('  allergic to ammonia ')).toEqual({
      ok: true,
      note: 'allergic to ammonia',
    });
  });

  it('rejects an over-long note', () => {
    expect(parseNote('x'.repeat(MAX_NOTE_LENGTH + 1))).toEqual({ ok: false });
  });
});

describe('parsePhoneInput', () => {
  it('passes real input straight through for normalisePhone to judge', () => {
    expect(parsePhoneInput('050-123-4567')).toBe('050-123-4567');
    expect(parsePhoneInput(' +972 50 123 4567 ')).toBe('+972 50 123 4567');
  });

  it('rejects empty and absurd lengths', () => {
    expect(parsePhoneInput('')).toBeNull();
    expect(parsePhoneInput('   ')).toBeNull();
    expect(parsePhoneInput('9'.repeat(33))).toBeNull();
  });
});

describe('retryAfterMinutes', () => {
  it('rounds up so a partial minute is never reported as zero', () => {
    expect(retryAfterMinutes(1)).toBe(1);
    expect(retryAfterMinutes(59_000)).toBe(1);
    expect(retryAfterMinutes(60_000)).toBe(1);
    expect(retryAfterMinutes(61_000)).toBe(2);
    expect(retryAfterMinutes(15 * 60_000)).toBe(15);
  });

  it('never says zero minutes, whatever it is handed', () => {
    expect(retryAfterMinutes(0)).toBe(1);
    expect(retryAfterMinutes(-5)).toBe(1);
    expect(retryAfterMinutes(Number.NaN)).toBe(1);
  });
});

describe('parseEmail', () => {
  it('treats absent, null and empty as "no email"', () => {
    // The field is optional and only rendered when the business asked for it at all,
    // so a blank box is a customer answering the question, not failing to.
    expect(parseEmail(undefined)).toEqual({ ok: true });
    expect(parseEmail(null)).toEqual({ ok: true });
    expect(parseEmail('')).toEqual({ ok: true });
    expect(parseEmail('   ')).toEqual({ ok: true });
  });

  it('accepts ordinary addresses and trims surrounding whitespace', () => {
    expect(parseEmail('dana@example.com')).toEqual({ ok: true, email: 'dana@example.com' });
    expect(parseEmail('  dana@example.com  ')).toEqual({ ok: true, email: 'dana@example.com' });
    expect(parseEmail('dana.cohen+booking@mail.example.co.il')).toEqual({
      ok: true,
      email: 'dana.cohen+booking@mail.example.co.il',
    });
  });

  it('preserves case — the local part is case-sensitive and nothing keys off it', () => {
    expect(parseEmail('Dana.Cohen@Example.com')).toEqual({
      ok: true,
      email: 'Dana.Cohen@Example.com',
    });
  });

  it('rejects the mistake it actually exists to catch: the wrong thing in the box', () => {
    expect(parseEmail('050-123-4567')).toEqual({ ok: false });
    expect(parseEmail('Dana Cohen')).toEqual({ ok: false });
  });

  it('rejects malformed addresses', () => {
    expect(parseEmail('dana@')).toEqual({ ok: false });
    expect(parseEmail('@example.com')).toEqual({ ok: false });
    expect(parseEmail('dana@example')).toEqual({ ok: false }); // no dot in the domain
    expect(parseEmail('dana@@example.com')).toEqual({ ok: false });
    expect(parseEmail('dana @example.com')).toEqual({ ok: false });
    expect(parseEmail('dana@example..com')).toEqual({ ok: false });
    expect(parseEmail('dana@.example.com')).toEqual({ ok: false });
  });

  it('rejects anything that is not a string', () => {
    expect(parseEmail(42)).toEqual({ ok: false });
    expect(parseEmail({ toString: () => 'dana@example.com' })).toEqual({ ok: false });
  });

  it('rejects an address longer than SMTP will carry', () => {
    const tooLong = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`;
    expect(parseEmail(tooLong)).toEqual({ ok: false });

    const atTheLimit = `${'a'.repeat(MAX_EMAIL_LENGTH - '@example.com'.length)}@example.com`;
    expect(atTheLimit).toHaveLength(MAX_EMAIL_LENGTH);
    expect(parseEmail(atTheLimit)).toEqual({ ok: true, email: atTheLimit });
  });
});
