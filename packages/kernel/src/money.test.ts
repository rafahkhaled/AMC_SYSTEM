import { describe, expect, it } from 'vitest';
import { ProgrammerError } from './errors.js';
import { Money } from './money.js';

describe('Money', () => {
  it('reads a major amount into exact minor units', () => {
    expect(Money.ofMajor('1250.75', 'AED').minorUnits).toBe(125_075);
    expect(Money.ofMajor(300, 'AED').minorUnits).toBe(30_000);
    expect(Money.ofMajor('-40.05', 'AED').minorUnits).toBe(-4_005);
    expect(Money.ofMajor('7', 'AED').minorUnits).toBe(700);
  });

  it('refuses more precision than the currency carries, instead of rounding quietly', () => {
    expect(() => Money.ofMajor('10.005', 'AED')).toThrow(ProgrammerError);
  });

  it('survives the decimals that break floating point', () => {
    // 0.1 + 0.2 is the classic failure. Here it is exact.
    const total = Money.ofMajor('0.10', 'AED').add(Money.ofMajor('0.20', 'AED'));
    expect(total.toMajorString()).toBe('0.30');
  });

  it('refuses to mix currencies', () => {
    expect(() => Money.ofMajor(1, 'AED').add(Money.ofMajor(1, 'USD'))).toThrow(ProgrammerError);
  });

  it('rounds half away from zero when scaling', () => {
    // 2.5 fils rounds up to 3, and -2.5 rounds down to -3.
    expect(Money.ofMinor(100, 'AED').scaleByRatio(90, 3600).minorUnits).toBe(3);
    expect(Money.ofMinor(-100, 'AED').scaleByRatio(90, 3600).minorUnits).toBe(-3);
  });

  it('applies VAT in basis points', () => {
    const net = Money.ofMajor('1000.00', 'AED');
    expect(net.percentageInBasisPoints(500).toMajorString()).toBe('50.00');
  });

  it('allocates without losing or inventing a fils', () => {
    const shares = Money.ofMajor('100.00', 'AED').allocate([1, 1, 1]);
    expect(shares.map((share) => share.minorUnits)).toEqual([3334, 3333, 3333]);
    expect(Money.sum(shares, 'AED').toMajorString()).toBe('100.00');
  });

  it('allocates by weight', () => {
    const shares = Money.ofMajor('10.00', 'AED').allocate([3, 1]);
    expect(shares.map((share) => share.toMajorString())).toEqual(['7.50', '2.50']);
  });

  it('prints an exact decimal that can be stored and compared', () => {
    expect(Money.ofMinor(5, 'AED').toMajorString()).toBe('0.05');
    expect(Money.ofMinor(-5, 'AED').toMajorString()).toBe('-0.05');
    expect(Money.zero('AED').toMajorString()).toBe('0.00');
  });

  it('compares and sums', () => {
    const small = Money.ofMajor('10.00', 'AED');
    const large = Money.ofMajor('20.00', 'AED');
    expect(small.compare(large)).toBe(-1);
    expect(large.compare(small)).toBe(1);
    expect(small.compare(Money.ofMajor('10.00', 'AED'))).toBe(0);
    expect(Money.sum([small, large], 'AED').toMajorString()).toBe('30.00');
  });
});
