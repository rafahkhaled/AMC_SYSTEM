import { describe, expect, it } from 'vitest';
import { formatHours, minorUnitsFrom } from './money.js';

describe('reading an amount somebody typed', () => {
  it('takes whole and part amounts', () => {
    expect(minorUnitsFrom('500')).toBe(50_000);
    expect(minorUnitsFrom('500.50')).toBe(50_050);
    expect(minorUnitsFrom('500.5')).toBe(50_050);
    expect(minorUnitsFrom('0.05')).toBe(5);
    expect(minorUnitsFrom('1,250.00')).toBe(125_000);
  });

  it('never holds a float, so the familiar cases are exact', () => {
    // 0.1 + 0.2 arithmetic is why this parses digits rather than multiplying.
    expect(minorUnitsFrom('0.10')).toBe(10);
    expect(minorUnitsFrom('0.20')).toBe(20);
    expect(minorUnitsFrom('8.15')).toBe(815);
    expect(minorUnitsFrom('1234567.89')).toBe(123_456_789);
  });

  it('refuses what is not an amount', () => {
    expect(minorUnitsFrom('')).toBeNull();
    expect(minorUnitsFrom('abc')).toBeNull();
    expect(minorUnitsFrom('-5')).toBeNull();
    // Three decimal places is not fils, and rounding it silently would bill
    // a figure nobody typed.
    expect(minorUnitsFrom('1.234')).toBeNull();
  });
});

describe('hours', () => {
  it('reads them as a person says them', () => {
    expect(formatHours(3600)).toBe('1.00h');
    expect(formatHours(12_600)).toBe('3.50h');
    expect(formatHours(0)).toBe('0.00h');
  });
});
