import { describe, expect, it } from 'vitest';
import { matches } from './search.js';

describe('searching what was pasted', () => {
  it('finds a name copied with invisible marks and odd spaces', () => {
    expect(matches('ALNASR ALDHAHABI TRANSPORT LLC', '‏Alnasr Aldhahabi ')).toBe(true);
  });

  it('finds L.L.C as LLC, and a tax number written in groups', () => {
    expect(matches('Forma7 Concepts LLC', 'forma7 concepts l.l.c')).toBe(true);
    expect(matches('100123456700003', '100 123 456 700 003')).toBe(true);
  });

  it('finds Arabic however the alef or the digits were written', () => {
    expect(matches('شركة الأمل للتجارة', 'شركه الامل')).toBe(true);
    expect(matches('100123', '١٠٠١٢٣')).toBe(true);
  });

  it('does not find what is not there', () => {
    expect(matches('Gulf Trading LLC', 'marina')).toBe(false);
  });
});
