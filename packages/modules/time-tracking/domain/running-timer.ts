import { Conflict, Duration, type Result, err, ok } from '@amc/kernel';

/**
 * The timer that is running right now, for one person.
 *
 * One per person is the rule (FR-21), so this is keyed by the person rather
 * than by the task. Starting a second timer stops the first and records it,
 * because the alternative, refusing, means somebody moving between jobs loses
 * the minutes while they work out what to click.
 */
export interface RunningTimerState {
  readonly userId: string;
  readonly assignmentId: string;
  readonly startedAt: Date;
  /** The device it was started on, so a phone and a laptop can be told apart. */
  readonly deviceId: string | null;
  /** Last sign of life, which is how an abandoned timer is spotted (FR-25). */
  readonly lastSeenAt: Date;
}

export interface StoppedTimer {
  readonly assignmentId: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** How long without a heartbeat before a timer is treated as abandoned. */
export const ABANDONED_AFTER_MINUTES = 60;

export class RunningTimer {
  private constructor(private state: RunningTimerState) {}

  static start(params: {
    userId: string;
    assignmentId: string;
    now: Date;
    deviceId?: string | null;
  }): RunningTimer {
    return new RunningTimer({
      userId: params.userId,
      assignmentId: params.assignmentId,
      startedAt: params.now,
      deviceId: params.deviceId ?? null,
      lastSeenAt: params.now,
    });
  }

  static rehydrate(state: RunningTimerState): RunningTimer {
    return new RunningTimer(state);
  }

  get userId(): string {
    return this.state.userId;
  }

  get assignmentId(): string {
    return this.state.assignmentId;
  }

  get startedAt(): Date {
    return this.state.startedAt;
  }

  elapsedAt(now: Date): Duration {
    const length = Duration.tryBetween(this.state.startedAt, now);
    return length.ok ? length.value : Duration.zero();
  }

  /**
   * The timer is still on screen somewhere.
   *
   * Heartbeats are what distinguish "working" from "left the browser open on
   * Thursday", and the difference is a day of billable time either way.
   */
  beat(now: Date): void {
    this.state = { ...this.state, lastSeenAt: now };
  }

  /** Nothing has been heard for long enough that the time is in doubt. */
  isAbandonedAt(now: Date): boolean {
    const silent = now.getTime() - this.state.lastSeenAt.getTime();
    return silent > ABANDONED_AFTER_MINUTES * 60_000;
  }

  /**
   * Stop, and hand back what should be recorded.
   *
   * The timer itself records nothing. It reports a span and lets the caller
   * decide what to do with it, which is what lets an abandoned one be trimmed
   * back to its last heartbeat instead of billing the night.
   */
  stop(now: Date): Result<StoppedTimer, Conflict> {
    if (now.getTime() < this.state.startedAt.getTime()) {
      return err(new Conflict('A timer cannot stop before it started'));
    }
    return ok({
      assignmentId: this.state.assignmentId,
      startedAt: this.state.startedAt,
      endedAt: now,
    });
  }

  /**
   * Stop an abandoned timer at its last heartbeat rather than now.
   *
   * A laptop closed at six and reopened on Monday would otherwise record the
   * weekend. Trimming to the last sign of life is the honest answer, and the
   * person is asked to confirm it (FR-25).
   */
  stopAsAbandoned(): StoppedTimer {
    return {
      assignmentId: this.state.assignmentId,
      startedAt: this.state.startedAt,
      endedAt: this.state.lastSeenAt,
    };
  }

  snapshot(): RunningTimerState {
    return this.state;
  }
}
