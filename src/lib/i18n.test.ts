import { describe, expect, it } from 'vitest';
import { dict, dirFor, getT, parseLangCookie } from './i18n';

describe('getT', () => {
  it('resolves a real key in each language', () => {
    expect(getT('en')('nav.home')).toBe('Home');
    expect(getT('he')('nav.home')).toBe('בית');
  });

  it('falls back to English when the target language is missing a key', () => {
    const key = 'privacy.title';
    const original = dict.he[key];
    delete (dict.he as Record<string, string | undefined>)[key];

    try {
      expect(getT('he')(key)).toBe(dict.en[key]);
    } finally {
      dict.he[key] = original;
    }
  });

  it('falls back to the key itself when it exists in neither language', () => {
    const key = 'nonexistent.key.does.not.exist';
    expect(getT('en')(key)).toBe(key);
    expect(getT('he')(key)).toBe(key);
  });

  it('every key present in the English dictionary also exists in Hebrew', () => {
    const missing = Object.keys(dict.en).filter((key) => !(key in dict.he));
    expect(missing).toEqual([]);
  });

  it('every key present in the Hebrew dictionary also exists in English', () => {
    const extra = Object.keys(dict.he).filter((key) => !(key in dict.en));
    expect(extra).toEqual([]);
  });
});

describe('dirFor', () => {
  it('is rtl for Hebrew and ltr for English', () => {
    expect(dirFor('he')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
  });
});

describe('parseLangCookie', () => {
  it('treats only the literal "he" as Hebrew', () => {
    expect(parseLangCookie('he')).toBe('he');
    expect(parseLangCookie('en')).toBe('en');
    expect(parseLangCookie(undefined)).toBe('en');
    expect(parseLangCookie(null)).toBe('en');
    expect(parseLangCookie('HE')).toBe('en');
    expect(parseLangCookie('')).toBe('en');
    expect(parseLangCookie('anything-else')).toBe('en');
  });
});
