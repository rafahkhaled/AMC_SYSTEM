import type { Duration } from '@amc/kernel';
import type { RunningTimer, TimeEntry, TimeEntryId, WorkingHours } from '../domain/index.js';

/** A day's worth of somebody's time, for the timesheet (FR-24). */
export interface TimesheetRow {
  readonly day: string;
  readonly seconds: number;
  readonly billableSeconds: number;
}

/** Approved hours not yet on a statement, which is what billing asks for. */
export interface UnbilledTime {
  readonly entryId: string;
  readonly assignmentId: string;
  readonly clientId: string;
  readonly taskId: string;
  readonly userId: string;
  readonly startedAt: Date;
  readonly seconds: number;
}

/**
 * When somebody is expected to be working (FR-25).
 *
 * Supplied rather than assumed, because the default of Monday to Friday is a
 * default and not a rule: plenty of practices here work Sunday to Thursday.
 */
export interface WorkingHoursRepository {
  forUser(userId: string): Promise<WorkingHours>;
  save(hours: WorkingHours): Promise<void>;
}

export interface TimeEntryRepository {
  findById(id: TimeEntryId): Promise<TimeEntry | null>;
  forAssignment(assignmentId: string): Promise<TimeEntry[]>;
  /** Everything a person recorded between two instants. */
  forUserBetween(userId: string, from: Date, to: Date): Promise<TimeEntry[]>;
  timesheet(userId: string, from: Date, to: Date): Promise<TimesheetRow[]>;
  /** What this person still has to confirm before it can be billed (FR-25). */
  awaitingReview(userId: string): Promise<TimeEntry[]>;
  unbilledForClient(clientId: string, upTo: Date): Promise<UnbilledTime[]>;
  save(entry: TimeEntry): Promise<void>;
}

export interface RunningTimerRepository {
  forUser(userId: string): Promise<RunningTimer | null>;
  /** Timers that have not been heard from, for the sweep that trims them. */
  stale(before: Date): Promise<RunningTimer[]>;
  start(timer: RunningTimer): Promise<void>;
  /** Writes back a timer that was held or resumed. */
  save(timer: RunningTimer): Promise<void>;
  beat(userId: string, at: Date): Promise<void>;
  clear(userId: string): Promise<void>;
}

export interface TotalledTime {
  readonly total: Duration;
  readonly billable: Duration;
}
