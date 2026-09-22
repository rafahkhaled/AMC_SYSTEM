import { beforeEach, describe, expect, it } from 'vitest';
import { applyLanguage, setUpI18n, storedLanguage } from './index.js';
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
          : // Counted strings compared by their base name: English has two
            // plural categories and Arabic six, so the two bundles legitimately
            // hold a different number of keys for the same piece of text.
            [`${prefix}${key}`.replace(/_(zero|one|two|few|many|other)$/, '')],
      );

    const ar = [...new Set(flatten(translations.ar))].sort();
    const en = [...new Set(flatten(translations.en))].sort();
    expect(ar).toEqual(en);
  });
});

describe('counting, in a language that counts differently', () => {
  /*
   * Arabic has six plural categories — zero, one, two, few (3–10),
   * many (11–99), other (100+) — and i18next does not fall back from a
   * missing one to `_other`. It returns the key, so the screen reads
   * "clients.needsAttention" where it should read "3 documents need
   * attention". With only `_one` and `_other` defined, that was every count
   * except one, in the language the firm actually works in.
   */
  const COUNTS = [0, 1, 2, 3, 7, 11, 42, 99, 100, 101];

  function pluralKeys(bundle: Record<string, unknown>, path: string[] = []): string[] {
    const found: string[] = [];
    for (const [name, value] of Object.entries(bundle)) {
      if (value && typeof value === 'object') {
        found.push(...pluralKeys(value as Record<string, unknown>, [...path, name]));
      } else if (/_(zero|one|two|few|many|other)$/.test(name)) {
        found.push([...path, name.replace(/_(zero|one|two|few|many|other)$/, '')].join('.'));
      }
    }
    return found;
  }

  it('renders every counted string at every count, in both languages', async () => {
    const i18n = await setUpI18n();

    for (const language of ['ar', 'en'] as const) {
      await i18n.changeLanguage(language);
      const keys = [...new Set(pluralKeys(translations[language]))];
      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        for (const count of COUNTS) {
          const rendered = i18n.t(key, { count });
          // The failure is not an exception: it is the key itself, printed.
          expect(rendered, `${language} ${key} at ${count}`).not.toBe(key);
          expect(rendered, `${language} ${key} at ${count}`).not.toContain(key);
        }
      }
    }
  });
});
