import { describe, expect, it } from 'vitest';
import { decodeUploadName } from './upload-name.js';

/** What a multipart parser does to a name: UTF-8 bytes read as latin1. */
const mangled = (name: string) => Buffer.from(name, 'utf8').toString('latin1');

describe('the name an uploaded file arrives with', () => {
  it('puts Arabic back the way it was typed', () => {
    for (const name of ['كشف الحساب.pdf', 'رخصة تجارية 2026.docx', 'ملف.xlsx']) {
      expect(mangled(name)).not.toBe(name);
      expect(decodeUploadName(mangled(name))).toBe(name);
    }
  });

  it('puts other accented names back too', () => {
    expect(decodeUploadName(mangled('Résumé – final.pdf'))).toBe('Résumé – final.pdf');
  });

  it('leaves a plain name exactly as it is', () => {
    expect(decodeUploadName('statements.csv')).toBe('statements.csv');
    expect(decodeUploadName('Bank statements 2026 (1).xlsx')).toBe('Bank statements 2026 (1).xlsx');
  });

  it('does not touch a name somebody already decoded correctly', () => {
    expect(decodeUploadName('كشف الحساب.pdf')).toBe('كشف الحساب.pdf');
  });

  it('leaves alone a name that was never UTF-8, rather than turning it into replacement marks', () => {
    // A lone 0xE9 is "é" in latin1 and invalid as UTF-8.
    expect(decodeUploadName('café.pdf')).toBe('café.pdf');
  });
});
