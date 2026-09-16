import { describe, expect, it } from 'vitest';
import { ABANDONED_AFTER_MINUTES, RunningTimer } from './running-timer.js';

const at = (iso: string) => new Date(iso);

function timer(startedAt = '2026-04-01T09:00:00Z') {
  return RunningTimer.start({
    userId: 'user-1',
    assignmentId: 'assign-1',
    now: at(startedAt),
    deviceId: 'phone',
  });
}

describe('the running timer (FR-21)', () => {
  it('reports how long it has been going', () => {
    expect(timer().elapsedAt(at('2026-04-01T10:45:00Z')).toHoursAndMinutes()).toBe('1:45');
  });

  it('hands back a span to record when it stops', () => {
    const stopped = timer().stop(at('2026-04-01T10:30:00Z'));
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    expect(stopped.value.assignmentId).toBe('assign-1');
    expect(stopped.value.endedAt.toISOString()).toBe('2026-04-01T10:30:00.000Z');
  });

  it('refuses to stop before it started, which a wrong device clock can ask for', () => {
    expect(timer().stop(at('2026-04-01T08:00:00Z')).ok).toBe(false);
  });
});

describe('abandoned timers (FR-25)', () => {
  it('is not abandoned while it keeps being seen', () => {
    const running = timer();
    running.beat(at('2026-04-01T11:00:00Z'));
    expect(running.isAbandonedAt(at('2026-04-01T11:30:00Z'))).toBe(false);
  });

  it('is abandoned after an hour of silence', () => {
    const running = timer();
    running.beat(at('2026-04-01T11:00:00Z'));
    const later = new Date(
      at('2026-04-01T11:00:00Z').getTime() + (ABANDONED_AFTER_MINUTES + 1) * 60_000,
    );
    expect(running.isAbandonedAt(later)).toBe(true);
  });

  it('stops at the last sign of life rather than billing the weekend', () => {
    // A laptop closed at six on Friday and reopened on Monday would otherwise
    // record three days against a client.
    const running = timer('2026-04-03T09:00:00Z');
    running.beat(at('2026-04-03T18:00:00Z'));

    const trimmed = running.stopAsAbandoned();
    expect(trimmed.endedAt.toISOString()).toBe('2026-04-03T18:00:00.000Z');
  });

  it('keeps the device it was started on, so a phone and a laptop differ', () => {
    expect(timer().snapshot().deviceId).toBe('phone');
  });
});

describe('holding a timer (FR-21)', () => {
  it('records the span up to the hold, and counts nothing after it', () => {
    const running = timer('2026-04-01T09:00:00Z');

    const held = running.hold(at('2026-04-01T09:40:00Z'));

    expect(held.ok).toBe(true);
    if (held.ok) {
      expect(held.value.startedAt.toISOString()).toBe('2026-04-01T09:00:00.000Z');
      expect(held.value.endedAt.toISOString()).toBe('2026-04-01T09:40:00.000Z');
    }
    expect(running.isHeld).toBe(true);
    // An hour of interruption later, still nothing.
    expect(running.elapsedAt(at('2026-04-01T10:40:00Z')).seconds).toBe(0);
  });

  it('starts a fresh span on resume, so the interruption bills nothing', () => {
    const running = timer('2026-04-01T09:00:00Z');
    running.hold(at('2026-04-01T09:40:00Z'));

    expect(running.resume(at('2026-04-01T11:00:00Z')).ok).toBe(true);
    expect(running.isHeld).toBe(false);
    // Ten minutes since resuming, not two hours and ten since starting.
    expect(running.elapsedAt(at('2026-04-01T11:10:00Z')).seconds).toBe(600);
  });

  it('records nothing when a held timer is stopped', () => {
    // The span was written when the hold began. Writing it again on stop
    // would bill the same minutes twice.
    const running = timer('2026-04-01T09:00:00Z');
    running.hold(at('2026-04-01T09:40:00Z'));

    const stopped = running.stop(at('2026-04-01T14:00:00Z'));

    expect(stopped.ok).toBe(true);
    if (stopped.ok) {
      expect(stopped.value.endedAt.getTime()).toBe(stopped.value.startedAt.getTime());
    }
  });

  it('is never abandoned while held, because nothing is at risk', () => {
    // A held timer has no open span to trim. Sweeping it would only lose the
    // task somebody paused, which is the one thing holding exists to keep.
    const running = timer('2026-04-01T09:00:00Z');
    running.hold(at('2026-04-01T09:40:00Z'));

    const daysLater = at('2026-04-05T09:00:00Z');
    expect(running.isAbandonedAt(daysLater)).toBe(false);
    expect(running.stopAsAbandoned().endedAt.getTime()).toBe(
      running.stopAsAbandoned().startedAt.getTime(),
    );
  });

  it('refuses to hold twice, and to resume what is not held', () => {
    const running = timer('2026-04-01T09:00:00Z');
    expect(running.resume(at('2026-04-01T09:10:00Z')).ok).toBe(false);

    running.hold(at('2026-04-01T09:40:00Z'));
    expect(running.hold(at('2026-04-01T09:50:00Z')).ok).toBe(false);
  });
});

describe('replaying what happened while the browser was offline (NFR-03)', () => {
  /*
   * The client supplies the instant it believes an action happened. For
   * billable time that needs a boundary rather than a promise, and the
   * boundary is chosen so the client can only ever shorten a span.
   */
  it('accepts an instant between the start and now', () => {
    const running = timer('2026-04-01T09:00:00Z');
    const claimed = at('2026-04-01T09:40:00Z');

    expect(running.clamp(claimed, at('2026-04-01T10:00:00Z'))).toEqual(claimed);
  });

  it('refuses the future, because it has not happened', () => {
    const running = timer('2026-04-01T09:00:00Z');
    const now = at('2026-04-01T10:00:00Z');

    expect(running.clamp(at('2026-04-01T18:00:00Z'), now)).toEqual(now);
  });

  it('refuses an instant before the timer was running', () => {
    // Otherwise a client could claim a stop that predates the start and write
    // a negative span, or bill an hour the timer was not counting.
    const running = timer('2026-04-01T09:00:00Z');

    expect(running.clamp(at('2026-04-01T06:00:00Z'), at('2026-04-01T10:00:00Z'))).toEqual(
      at('2026-04-01T09:00:00Z'),
    );
  });

  it('measures a held timer from the hold, not from the original start', () => {
    const running = timer('2026-04-01T09:00:00Z');
    running.hold(at('2026-04-01T09:40:00Z'));

    expect(running.clamp(at('2026-04-01T09:10:00Z'), at('2026-04-01T12:00:00Z'))).toEqual(
      at('2026-04-01T09:40:00Z'),
    );
  });

  it('uses now when the client claims nothing', () => {
    const running = timer('2026-04-01T09:00:00Z');
    const now = at('2026-04-01T10:00:00Z');

    expect(running.clamp(undefined, now)).toEqual(now);
  });
});
