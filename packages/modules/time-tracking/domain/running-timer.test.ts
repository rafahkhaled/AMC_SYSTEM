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
