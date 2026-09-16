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
    return this.record(span);
  }

  /**
   * Write a finished span down, if there is anything to write.
   *
   * A span of no length records nothing. Someone who starts and immediately
   * stops has not worked, and a zero-length entry on a statement is a question
   * the firm does not want to answer. The same is true of a timer stopped
   * while already held, whose span was recorded when the hold began.
   */
  private async record(span: {
    assignmentId: string;
    startedAt: Date;
    endedAt: Date;
  }): Promise<Result<StoppedEntry | null, Conflict>> {
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

  /**
   * Hold the timer, recording the span so far.
   *
   * The work is interrupted, not finished: a call comes in, a colleague asks
   * something, the client is on the other line. Stopping would lose which task
   * was in hand and make resuming a search through the client file. Holding
   * keeps the task and bills none of the interruption.
   */
  async hold(params: { userId: string }): Promise<Result<StoppedEntry | null, Conflict>> {
    const running = await this.timers.forUser(params.userId);
    if (!running) return err(new Conflict('No timer is running'));

    const now = this.clock.now();
    const span = running.hold(now);
    if (!span.ok) return err(span.error);

    await this.timers.save(running);
    return this.record(span.value);
  }

  /** Lift a hold. The next span starts now, so the pause bills nothing. */
  async resume(params: { userId: string }): Promise<Result<void, Conflict>> {
    const running = await this.timers.forUser(params.userId);
    if (!running) return err(new Conflict('No timer is held'));

    const lifted = running.resume(this.clock.now());
    if (!lifted.ok) return lifted;

    await this.timers.save(running);
    return ok(undefined);
  }

  /**
   * Record time that was worked but not timed (FR-22).
   *
   * The reason is not optional, in the domain or in the database. Time typed
   * in afterwards is the part of a client statement most likely to be
   * questioned, and an entry that cannot say why it exists is one the firm
   * has to defend without evidence.
   *
   * Nothing here touches the running timer. Someone remembering yesterday
   * afternoon should not lose what they are timing right now.
   */
  async recordManual(params: {
    userId: string;
    taskId: string;
    startedAt: Date;
    endedAt: Date;
    reason: string;
    billable?: boolean;
    note?: string | null;
  }): Promise<Result<StoppedEntry, Conflict>> {
    const assignment = await this.assignments.forUserOnTask({
      userId: params.userId,
      taskId: params.taskId,
      assignedBy: params.userId,
    });
    if (!assignment) return err(new Conflict('No such task'));

    if (params.endedAt.getTime() > this.clock.now().getTime()) {
      return err(new Conflict('Time cannot be recorded for work not yet done'));
    }

    const entry = TimeEntry.manual({
      id: this.ids.next(),
      assignmentId: assignment.assignmentId,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      reason: params.reason,
      ...(params.billable === undefined ? {} : { billable: params.billable }),
      ...(params.note === undefined ? {} : { note: params.note }),
    });
    if (!entry.ok) return err(entry.error);

    await this.entries.save(entry.value);
    return ok({
      entryId: entry.value.id,
      seconds: entry.value.length.seconds,
    });
  }

  /** Tell the server the timer is still on screen (FR-25). */
  async beat(userId: string): Promise<void> {
    await this.timers.beat(userId, this.clock.now());
  }
}
