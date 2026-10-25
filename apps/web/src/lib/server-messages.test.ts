import { afterEach, describe, expect, it } from 'vitest';
import { inReadersLanguage } from './server-messages.js';

describe('what the server says, in the reader’s language', () => {
  afterEach(() => {
    document.documentElement.lang = '';
  });

  it('puts a known refusal into Arabic for an Arabic reader', () => {
    document.documentElement.lang = 'ar';
    expect(
      inReadersLanguage('That client has no email address on file; send it by hand instead'),
    ).toContain('لا يوجد بريد إلكتروني لهذا العميل');
  });

  it('leaves it in English for an English reader', () => {
    document.documentElement.lang = 'en';
    expect(inReadersLanguage('Those details are not right')).toBe('Those details are not right');
  });

  it('shows one with no Arabic yet as it is, rather than nothing', () => {
    document.documentElement.lang = 'ar';
    expect(inReadersLanguage('Something brand new went wrong')).toBe(
      'Something brand new went wrong',
    );
  });
});
