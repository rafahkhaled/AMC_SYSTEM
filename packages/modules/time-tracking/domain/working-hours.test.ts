import { describe, expect, it } from 'vitest';
import { WorkingHours } from './working-hours.js';

/** Dubai is UTC+4, so 09:00 local is 05:00 UTC. */
const dubai = (day: string, clock: string) => new Date(`${day}T${clock}:00+04:00`);

const NINE_TO_SIX = WorkingHours.default('user-a');

describe('when somebody is expected to be working (FR-25)', () => {
  it('covers the middle of a working day', () => {
    // 2026-09-16 is a Wednesday.
    expect(NINE_TO_SIX.covers(dubai('2026-09-16', '14:00'))).toBe(true);
  });

  it('starts on the hour and ends on it', () => {
    // Nine o'clock is working; six o'clock is not. The day is half open, so a
    // timer stopped exactly at six is not queried for being one second late.
    expect(NINE_TO_SIX.covers(dubai('2026-09-16', '09:00'))).toBe(true);
    expect(NINE_TO_SIX.covers(dubai('2026-09-16', '17:59'))).toBe(true);
    expect(NINE_TO_SIX.covers(dubai('2026-09-16', '18:00'))).toBe(false);
    expect(NINE_TO_SIX.covers(dubai('2026-09-16', '08:59'))).toBe(false);
  });

  it('reads the clock in Dubai, not wherever the server is', () => {
    // 22:00 UTC is two in the morning in Dubai, the next day. A server in
    // London would otherwise think this was the evening before.
    expect(NINE_TO_SIX.covers(new Date('2026-09-16T22:00:00Z'))).toBe(false);
    // 05:30 UTC is 09:30 in Dubai, which is the working day.
    expect(NINE_TO_SIX.covers(new Date('2026-09-16T05:30:00Z'))).toBe(true);
  });

  it('knows a weekend from a working day', () => {
    // Saturday and Sunday, under the default. The UAE weekend moved to these
    // two in January 2022.
    expect(NINE_TO_SIX.covers(dubai('2026-09-19', '14:00'))).toBe(false);
    expect(NINE_TO_SIX.covers(dubai('2026-09-20', '14:00'))).toBe(false);
  });

  it('accepts a Sunday to Thursday week, which is normal here', () => {
    const hours = WorkingHours.of({
      userId: 'user-b',
      startsAtMinutes: 8 * 60,
      endsAtMinutes: 16 * 60,
      workingDays: [7, 1, 2, 3, 4],
    });
    expect(hours.ok).toBe(true);
    if (!hours.ok) return;

    // Sunday is working for them and Friday is not.
    expect(hours.value.covers(dubai('2026-09-20', '10:00'))).toBe(true);
    expect(hours.value.covers(dubai('2026-09-18', '10:00'))).toBe(false);
  });

  it('questions a span that ends outside the day, not only one that starts there', () => {
    /*
     * A timer begun at five in the afternoon and stopped at nine the next
     * morning starts inside the working day. It is exactly the entry this
     * check exists for, so both ends are looked at.
     */
    expect(
      NINE_TO_SIX.questions({
        startedAt: dubai('2026-09-16', '17:00'),
        endedAt: dubai('2026-09-17', '09:30'),
      }),
    ).toBe(true);
  });

  it('asks nothing of a span that sits inside the day', () => {
    expect(
      NINE_TO_SIX.questions({
        startedAt: dubai('2026-09-16', '10:00'),
        endedAt: dubai('2026-09-16', '12:30'),
      }),
    ).toBe(false);
  });

  it('questions work done on a weekend, without refusing it', () => {
    // Filing season is filing season. The point is to ask, not to discard.
    expect(
      NINE_TO_SIX.questions({
        startedAt: dubai('2026-09-19', '10:00'),
        endedAt: dubai('2026-09-19', '13:00'),
      }),
    ).toBe(true);
  });

  it('refuses hours that make no sense', () => {
    const backwards = WorkingHours.of({
      userId: 'user-c',
      startsAtMinutes: 18 * 60,
      endsAtMinutes: 9 * 60,
      workingDays: [1],
    });
    expect(backwards.ok).toBe(false);

    const noDays = WorkingHours.of({
      userId: 'user-c',
      startsAtMinutes: 9 * 60,
      endsAtMinutes: 18 * 60,
      workingDays: [],
    });
    expect(noDays.ok).toBe(false);

    const eighthDay = WorkingHours.of({
      userId: 'user-c',
      startsAtMinutes: 9 * 60,
      endsAtMinutes: 18 * 60,
      workingDays: [1, 8],
    });
    expect(eighthDay.ok).toBe(false);
  });
});
