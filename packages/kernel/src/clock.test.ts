import { describe, expect, it } from 'vitest';
import { FixedClock, businessDate } from './clock.js';

describe('Clock', () => {
  it('lets a test stand still and then move', () => {
    const clock = new FixedClock(new Date('2026-09-14T06:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-09-14T06:00:00.000Z');
    clock.advanceDays(14);
    expect(clock.now().toISOString()).toBe('2026-09-28T06:00:00.000Z');
  });

  it('reports the Dubai calendar date, not the server one', () => {
    // 21:30 UTC is already the next day in Dubai, which is four hours ahead.
    expect(businessDate(new Date('2026-09-14T21:30:00Z'))).toBe('2026-09-15');
    expect(businessDate(new Date('2026-09-14T19:00:00Z'))).toBe('2026-09-14');
  });
});
