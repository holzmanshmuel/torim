import { describe, expect, it } from 'vitest';
import { isolate, stripBidiControls } from './bidi';

const FSI = '\u2068';
const PDI = '\u2069';

describe('isolate', () => {
  it('wraps text in FSI/PDI isolate marks', () => {
    expect(isolate('19.7 - 13.7')).toBe(`${FSI}19.7 - 13.7${PDI}`);
  });

  it('wraps an empty string too', () => {
    expect(isolate('')).toBe(`${FSI}${PDI}`);
  });

  it('keeps an LTR date range in its original order when embedded in a Hebrew sentence', () => {
    // The bug this exists for: a naive Hebrew string with a raw LTR date range renders
    // the range backwards (19.7-13.7 shows as 13.7-19.7) because the RTL paragraph
    // direction reorders the neutral '-' and the digit runs around it.
    const range = '19.7 - 13.7';
    const sentence = `פגישה בתאריכים ${isolate(range)}`;

    expect(sentence).toContain(`${FSI}${range}${PDI}`);
    // The isolated run's internal character order is untouched - isolate() never
    // rewrites the text, it only fences it so the bidi algorithm can't reorder it.
    expect(sentence.replace(FSI, '').replace(PDI, '')).toContain(range);
  });

  it('keeps an embedded time range intact next to Hebrew text', () => {
    const range = '12:00-10:00';
    const sentence = `הפגישה: ${isolate(range)}`;
    expect(sentence).toContain(`${FSI}${range}${PDI}`);
  });
});

describe('stripBidiControls', () => {
  it('leaves plain Hebrew and Latin text untouched', () => {
    const value = 'שלמה כהן';
    expect(stripBidiControls(value)).toBe(value);
    expect(stripBidiControls('Jane Doe')).toBe('Jane Doe');
  });

  it('removes isolate marks produced by isolate()', () => {
    const isolated = isolate('12:00-10:00');
    expect(stripBidiControls(isolated)).toBe('12:00-10:00');
  });

  it('scrubs an RLO/PDF override injected into a Hebrew name', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE / U+202C POP DIRECTIONAL FORMATTING. Left in an
    // admin list or an exported calendar feed, this reorders whatever text follows it -
    // this is exactly the injection stripBidiControls() exists to neutralize on write.
    const malicious = 'שלמה\u202Eevil\u202C כהן';
    expect(stripBidiControls(malicious)).toBe('שלמהevil כהן');
  });

  it('removes LRM/RLM marks', () => {
    const value = 'a\u200Eb\u200Fc';
    expect(stripBidiControls(value)).toBe('abc');
  });
});

describe('stripBidiControls — the full Bidi_Control set', () => {
  /**
   * U+061C ARABIC LETTER MARK is `Bidi_Control=Yes` and was missing from the class. It
   * is a weak marker like LRM/RLM rather than an override, so it can nudge neutral runs
   * in an RTL admin list but cannot reverse a whole string — low impact, but a
   * one-character gap in a function whose entire job is that set.
   */
  it('strips U+061C ARABIC LETTER MARK', () => {
    expect(stripBidiControls('\u061C\u061CAdmin')).toBe('Admin');
  });

  it('still strips every other member of the set', () => {
    const all = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F\u061C';
    expect(stripBidiControls(`a${all}b`)).toBe('ab');
  });
});
