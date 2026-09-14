import { describe, expect, it } from 'vitest';
import { Duration } from './duration.js';

describe('Duration', () => {
  it('measures the span between two instants in whole seconds', () => {
    const start = new Date('2026-09-14T08:00:00Z');
    const end = new Date('2026-09-14T09:30:00Z');
    expect(Duration.between(start, end).seconds).toBe(5_400);
  });

  it('returns a domain error rather than a negative span when a device clock ran backwards', () => {
    const result = Duration.tryBetween(new Date('2026-09-14T09:00:00Z'), new Date('2026-09-14T08:00:00Z'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('adds up a timesheet exactly', () => {
    const entries = [Duration.ofMinutes(37), Duration.ofMinutes(23), Duration.ofHours(2)];
    expect(Duration.sum(entries).toHoursAndMinutes()).toBe('3:00');
  });

  it('formats hours and minutes', () => {
    expect(Duration.ofSeconds(27_000).toHoursAndMinutes()).toBe('7:30');
    expect(Duration.ofSeconds(59).toHoursAndMinutes()).toBe('0:00');
    expect(Duration.ofSeconds(-3_600).toHoursAndMinutes()).toBe('-1:00');
  });

  it('gives decimal hours for reports only', () => {
    expect(Duration.ofSeconds(5_400).toDecimalHours()).toBe(1.5);
    expect(Duration.ofSeconds(1_000).toDecimalHours()).toBe(0.28);
  });
});
