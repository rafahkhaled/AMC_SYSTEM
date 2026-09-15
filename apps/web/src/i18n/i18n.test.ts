import { beforeEach, describe, expect, it } from 'vitest';
import { applyLanguage, storedLanguage } from './index.js';
import { translations } from './translations.js';

describe('language and direction', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
  });

  it('defaults to Arabic, because that is the working language', () => {
    expect(storedLanguage()).toBe('ar');
  });

  it('sets direction on the document, not on a component', () => {
    // The browser uses the document direction for text selection, scrollbars
    // and form controls that no stylesheet reaches.
    applyLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');

    applyLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('remembers the choice across a reload', () => {
    applyLanguage('en');
    expect(storedLanguage()).toBe('en');
  });

  it('falls back to Arabic when storage refuses, as in private browsing', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('storage is unavailable');
    };
    expect(storedLanguage()).toBe('ar');
    Storage.prototype.getItem = original;
  });

  it('switches the language without throwing when storage refuses a write', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('storage is unavailable');
    };
    expect(() => applyLanguage('en')).not.toThrow();
    expect(document.documentElement.dir).toBe('ltr');
    Storage.prototype.setItem = original;
  });

  it('has every English key in Arabic and the other way round', () => {
    // A missing key shows as raw dotted text to a real user, which is the sort
    // of thing that ships unnoticed in the language you do not read.
    const flatten = (value: object, prefix = ''): string[] =>
      Object.entries(value).flatMap(([key, entry]) =>
        typeof entry === 'object' && entry !== null
          ? flatten(entry, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );

    expect(flatten(translations.ar).sort()).toEqual(flatten(translations.en).sort());
  });
});
