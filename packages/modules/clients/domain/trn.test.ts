import { describe, expect, it } from 'vitest';
import { Trn } from './trn.js';

describe('tax registration number', () => {
  it('accepts fifteen digits', () => {
    const trn = Trn.of('100123456700003');
    expect(trn.ok && trn.value.value).toBe('100123456700003');
  });

  it('accepts the spacing people copy from a certificate', () => {
    expect(Trn.of('100 123 456 700 003').ok).toBe(true);
    expect(Trn.of('100-123-456-700-003').ok).toBe(true);
  });

  it('refuses the wrong length, and says what the length should be', () => {
    const short = Trn.of('1001234567');
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.message).toContain('15 digits');
    expect(Trn.of('1001234567000031').ok).toBe(false);
  });

  it('refuses letters and an empty value', () => {
    expect(Trn.of('10012345670000A').ok).toBe(false);
    expect(Trn.of('').ok).toBe(false);
    expect(Trn.of('   ').ok).toBe(false);
  });

  it('prints it grouped, the way it appears on the certificate', () => {
    const trn = Trn.of('100123456700003');
    expect(trn.ok && trn.value.format()).toBe('100 123 456 700 003');
  });

  it('compares by value, so the same number written differently is the same', () => {
    const first = Trn.of('100 123 456 700 003');
    const second = Trn.of('100123456700003');
    expect(first.ok && second.ok && first.value.equals(second.value)).toBe(true);
  });
});
