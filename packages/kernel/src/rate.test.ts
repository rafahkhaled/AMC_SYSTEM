import { describe, expect, it } from 'vitest';
import { Duration } from './duration.js';
import { Money } from './money.js';
import { Rate } from './rate.js';

describe('Rate', () => {
  const threeHundredAnHour = Rate.perHour(Money.ofMajor('300.00', 'AED'));

  it('bills an hour and a half at three hundred an hour as four hundred and fifty', () => {
    expect(threeHundredAnHour.amountFor(Duration.ofMinutes(90)).toMajorString()).toBe('450.00');
  });

  it('bills a short entry without drift', () => {
    expect(threeHundredAnHour.amountFor(Duration.ofMinutes(7)).toMajorString()).toBe('35.00');
    expect(threeHundredAnHour.amountFor(Duration.ofSeconds(1)).toMajorString()).toBe('0.08');
  });

  it('matches the sum of a month of entries against a hand calculation', () => {
    // Twenty-two working days at seven hours and twenty minutes.
    const daily = Duration.ofMinutes(440);
    const month = Duration.sum(Array.from({ length: 22 }, () => daily));
    expect(month.toHoursAndMinutes()).toBe('161:20');
    // 161 hours 20 minutes is 161.3333 hours. At AED 300 that is AED 48,400.00
    expect(threeHundredAnHour.amountFor(month).toMajorString()).toBe('48400.00');
  });

  it('treats a zero length entry as nothing owed', () => {
    expect(threeHundredAnHour.amountFor(Duration.zero()).isZero()).toBe(true);
  });

  it('refuses a negative rate', () => {
    expect(() => Rate.perHour(Money.ofMajor('-1.00', 'AED'))).toThrow();
  });
});
