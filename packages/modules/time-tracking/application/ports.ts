import type { Duration } from '@amc/kernel';
import type { RunningTimer, TimeEntry, TimeEntryId } from '../domain/index.js';

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

export interface TimeEntryRepository {
  findById(id: TimeEntryId): Promise<TimeEntry | null>;
  forAssignment(assignmentId: string): Promise<TimeEntry[]>;
  /** Everything a person recorded between two instants. */
  forUserBetween(userId: string, from: Date, to: Date): Promise<TimeEntry[]>;
  timesheet(userId: string, from: Date, to: Date): Promise<TimesheetRow[]>;
  unbilledForClient(clientId: string, upTo: Date): Promise<UnbilledTime[]>;
  save(entry: TimeEntry): Promise<void>;
}

export interface RunningTimerRepository {
  forUser(userId: string): Promise<RunningTimer | null>;
  /** Timers that have not been heard from, for the sweep that trims them. */
  stale(before: Date): Promise<RunningTimer[]>;
  start(timer: RunningTimer): Promise<void>;
  beat(userId: string, at: Date): Promise<void>;
  clear(userId: string): Promise<void>;
}

export interface TotalledTime {
  readonly total: Duration;
  readonly billable: Duration;
}
