import { describe, expect, it } from 'vitest';
import { bookingUid, buildIcs, escapeIcsText, foldIcsLine, formatIcsUtc, icsFilename } from './ics';

const START = new Date('2026-08-27T07:00:00Z'); // 10:00 in Asia/Jerusalem
const END = new Date('2026-08-27T07:30:00Z');
const STAMP = new Date('2026-08-20T12:34:56Z');

function lines(ics: string): string[] {
  return ics.split('\r\n');
}

/** Undo folding so a property's full value can be asserted. */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, '');
}

describe('formatIcsUtc', () => {
  it('emits basic-format UTC with the trailing Z', () => {
    expect(formatIcsUtc(START)).toBe('20260827T070000Z');
    expect(formatIcsUtc(new Date('2026-01-05T00:00:00Z'))).toBe('20260105T000000Z');
  });

  it('converts a non-UTC instant to UTC rather than printing local fields', () => {
    // 10:00 Jerusalem in August is UTC+3.
    expect(formatIcsUtc(new Date('2026-08-27T10:00:00+03:00'))).toBe('20260827T070000Z');
    // Israel is UTC+2 in winter, so the same wall clock is a different UTC time.
    expect(formatIcsUtc(new Date('2026-01-27T10:00:00+02:00'))).toBe('20260127T080000Z');
  });
});

describe('bookingUid', () => {
  it('is deterministic for a booking', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(bookingUid(id)).toBe(`booking-${id}@torim`);
    expect(bookingUid(id)).toBe(bookingUid(id));
  });
});

describe('escapeIcsText', () => {
  it('escapes the characters that would otherwise terminate a value', () => {
    expect(escapeIcsText('Cut, colour; blow-dry')).toBe('Cut\\, colour\\; blow-dry');
    expect(escapeIcsText('back\\slash')).toBe('back\\\\slash');
  });

  it('turns real newlines into the literal escape', () => {
    expect(escapeIcsText('one\ntwo')).toBe('one\\ntwo');
    expect(escapeIcsText('one\r\ntwo')).toBe('one\\ntwo');
  });

  it('escapes the backslash first, so an escape is not double-processed', () => {
    expect(escapeIcsText('a\\,b')).toBe('a\\\\\\,b');
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:Haircut')).toBe('SUMMARY:Haircut');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const long = `DESCRIPTION:${'a'.repeat(200)}`;
    const folded = foldIcsLine(long);
    expect(folded).toContain('\r\n ');
    for (const piece of folded.split('\r\n')) {
      expect(Buffer.byteLength(piece, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('counts UTF-8 octets, not characters, and never splits a code point', () => {
    // Hebrew is two bytes per letter: 60 characters is 120 octets and must fold.
    const hebrew = `SUMMARY:${'ש'.repeat(60)}`;
    const folded = foldIcsLine(hebrew);
    expect(folded).toContain('\r\n ');
    for (const piece of folded.split('\r\n')) {
      expect(Buffer.byteLength(piece, 'utf8')).toBeLessThanOrEqual(75);
    }
    // Reassembling must give back exactly the original — a split code point would not.
    expect(folded.replace(/\r\n /g, '')).toBe(hebrew);
  });

  it('does not split a surrogate pair', () => {
    const emoji = `SUMMARY:${'💇'.repeat(30)}`;
    const folded = foldIcsLine(emoji);
    expect(folded.replace(/\r\n /g, '')).toBe(emoji);
    expect(folded).not.toContain('�');
  });
});

describe('buildIcs', () => {
  const base = {
    uid: bookingUid('3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
    start: START,
    end: END,
    summary: 'Haircut · Lumen Beauty Studio',
    stamp: STAMP,
  };

  it('produces a well-formed single-event calendar', () => {
    const out = lines(buildIcs(base));
    expect(out[0]).toBe('BEGIN:VCALENDAR');
    expect(out).toContain('VERSION:2.0');
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
    expect(out[out.length - 2]).toBe('END:VCALENDAR');
    // RFC 5545 wants every line, including the last, CRLF-terminated.
    expect(out[out.length - 1]).toBe('');
  });

  it('uses CRLF line endings throughout', () => {
    const ics = buildIcs(base);
    expect(ics.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });

  it('writes the deterministic UID and correct UTC times', () => {
    const ics = unfold(buildIcs(base));
    expect(ics).toContain('UID:booking-3f2504e0-4f89-11d3-9a0c-0305e82c3301@torim');
    expect(ics).toContain('DTSTART:20260827T070000Z');
    expect(ics).toContain('DTEND:20260827T073000Z');
    expect(ics).toContain('DTSTAMP:20260820T123456Z');
  });

  it('re-generating the same booking produces an identical file', () => {
    expect(buildIcs(base)).toBe(buildIcs({ ...base }));
  });

  it('respects the business timezone by carrying it as a hint', () => {
    const ics = unfold(buildIcs({ ...base, timezone: 'Asia/Jerusalem' }));
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Jerusalem');
  });

  it('marks a screened booking TENTATIVE and a cancelled one CANCELLED', () => {
    expect(unfold(buildIcs({ ...base, status: 'TENTATIVE' }))).toContain('STATUS:TENTATIVE');
    expect(unfold(buildIcs({ ...base, status: 'CANCELLED' }))).toContain('STATUS:CANCELLED');
    expect(unfold(buildIcs(base))).toContain('STATUS:CONFIRMED');
  });

  it('carries SEQUENCE so a rescheduled booking can supersede the old entry', () => {
    expect(unfold(buildIcs({ ...base, sequence: 7 }))).toContain('SEQUENCE:7');
    expect(unfold(buildIcs(base))).toContain('SEQUENCE:0');
  });

  it('escapes a service name containing separators', () => {
    const ics = unfold(buildIcs({ ...base, summary: 'Cut, colour; style' }));
    expect(ics).toContain('SUMMARY:Cut\\, colour\\; style');
  });

  it('folds a long Hebrew summary without corrupting it', () => {
    const summary = 'ת'.repeat(80);
    const ics = buildIcs({ ...base, summary });
    for (const piece of lines(ics)) {
      expect(Buffer.byteLength(piece, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(unfold(ics)).toContain(`SUMMARY:${summary}`);
  });

  it('omits optional properties that were not supplied', () => {
    const ics = unfold(buildIcs(base));
    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('URL:');
    expect(ics).not.toContain('X-WR-TIMEZONE:');
  });

  it('refuses an event that ends before it starts', () => {
    expect(() => buildIcs({ ...base, end: new Date('2026-08-27T06:00:00Z') })).toThrow();
    expect(() => buildIcs({ ...base, end: START })).toThrow();
    expect(() => buildIcs({ ...base, start: new Date('nope') })).toThrow();
  });
});

describe('icsFilename', () => {
  it('produces a safe ASCII filename', () => {
    expect(icsFilename('Lumen Beauty Studio-Haircut')).toBe('Lumen-Beauty-Studio-Haircut.ics');
  });

  it('cannot break out of the Content-Disposition header value', () => {
    const name = icsFilename('evil"; filename="x.exe');
    expect(name).not.toContain('"');
    expect(name).not.toContain(';');
    expect(name.endsWith('.ics')).toBe(true);
  });

  it('falls back when nothing ASCII survives', () => {
    expect(icsFilename('סטודיו לומן')).toBe('appointment.ics');
  });

  it('strips control characters and path separators', () => {
    const name = icsFilename('a/b\\c\r\nd');
    expect(name).not.toMatch(/[/\\\r\n]/);
  });
});
