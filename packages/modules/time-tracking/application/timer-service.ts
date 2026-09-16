import { type Clock, Conflict, type IdGenerator, type Result, err, ok } from '@amc/kernel';
import { RunningTimer, TimeEntry } from '../domain/index.js';
import type { RunningTimerRepository, TimeEntryRepository } from './ports.js';

/**
 * Finds or creates the assignment a person should book time against.
 *
 * Supplied by the composition root, because assignments belong to the services
 * module. Starting a timer on a task you are not assigned to adds you as a
 * collaborator rather than refusing: people do help with each other's work,
 * and the alternative is either refusing the timer or recording time against
 * nobody, and FR-20 rules out the second.
 */
export interface AssignmentResolver {
  forUserOnTask(params: {
    userId: string;
    taskId: string;
    assignedBy: string;
  }): Promise<{ assignmentId: string } | null>;
}

export interface StoppedEntry {
  readonly entryId: string;
  readonly seconds: number;
}

export class TimerService {
  constructor(
    private readonly timers: RunningTimerRepository,
    private readonly entries: TimeEntryRepository,
    private readonly assignments: AssignmentResolver,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Start timing a task.
   *
   * Any timer already running is stopped and recorded first (FR-21). Refusing
   * instead would lose the minutes somebody spends working out what to click
   * when they move between jobs, which is exactly the time this system exists
   * to capture.
   */
  async start(params: {
    userId: string;
    taskId: string;
    deviceId?: string | null;
  }): Promise<Result<{ stopped: StoppedEntry | null }, Conflict>> {
    const now = this.clock.now();

    const assignment = await this.assignments.forUserOnTask({
      userId: params.userId,
      taskId: params.taskId,
      assignedBy: params.userId,
    });
    if (!assignment) return err(new Conflict('No such task'));

    const stopped = await this.stop({ userId: params.userId });

    await this.timers.start(
      RunningTimer.start({
        userId: params.userId,
        assignmentId: assignment.assignmentId,
        now,
        deviceId: params.deviceId ?? null,
      }),
    );

    return ok({ stopped: stopped.ok ? stopped.value : null });
  }

  /** Stop whatever is running, and record it. Stopping nothing is not an error. */
  async stop(params: { userId: string }): Promise<Result<StoppedEntry | null, Conflict>> {
    const running = await this.timers.forUser(params.userId);
    if (!running) return ok(null);

    const now = this.clock.now();
    // An abandoned timer is trimmed to its last heartbeat rather than billing
    // the intervening night (FR-25).
    const span = running.isAbandonedAt(now)
      ? running.stopAsAbandoned()
      : (() => {
          const stopped = running.stop(now);
          return stopped.ok ? stopped.value : running.stopAsAbandoned();
        })();

    await this.timers.clear(params.userId);

    // A span of no length records nothing. Someone who starts and immediately
    // stops has not worked, and a zero-length entry on a statement is a
    // question the firm does not want to answer.
    const seconds = Math.floor((span.endedAt.getTime() - span.startedAt.getTime()) / 1000);
    if (seconds <= 0) return ok(null);

    const entry = TimeEntry.fromTimer({
      id: this.ids.next(),
      assignmentId: span.assignmentId,
      startedAt: span.startedAt,
      endedAt: span.endedAt,
    });
    if (!entry.ok) return err(entry.error);

    await this.entries.save(entry.value);
    return ok({ entryId: entry.value.id, seconds });
  }

  /** Tell the server the timer is still on screen (FR-25). */
  async beat(userId: string): Promise<void> {
    await this.timers.beat(userId, this.clock.now());
  }
}
