import type { EventCollector } from '@amc/kernel';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  RunningTimerRepository,
  TimeEntryRepository,
  TimesheetRow,
  UnbilledTime,
} from '../application/ports.js';
import {
  type ReviewReason,
  RunningTimer,
  TimeEntry,
  type TimeEntryId,
  type TimeSource,
} from '../domain/index.js';
import { runningTimers, timeEntries } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

export class DrizzleTimeEntryRepository implements TimeEntryRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  async findById(id: TimeEntryId): Promise<TimeEntry | null> {
    const [row] = await this.db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
    return row ? toAggregate(row) : null;
  }

  async forAssignment(assignmentId: string): Promise<TimeEntry[]> {
    const rows = await this.db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.assignmentId, assignmentId))
      .orderBy(asc(timeEntries.startedAt));
    return rows.map(toAggregate);
  }

  async forUserBetween(userId: string, from: Date, to: Date): Promise<TimeEntry[]> {
    const rows = await this.db.execute<typeof timeEntries.$inferSelect>(sql`
      SELECT e.* FROM time_entries e
      JOIN task_assignments a ON a.id = e.assignment_id
      WHERE a.user_id = ${userId}
        AND e.started_at >= ${from.toISOString()}::timestamptz
        AND e.started_at < ${to.toISOString()}::timestamptz
      ORDER BY e.started_at
    `);
    return rows.map(toAggregate);
  }

  /**
   * A day-by-day total for one person (FR-24).
   *
   * Grouped in Dubai time rather than UTC, because a person's Tuesday is their
   * Tuesday. Work recorded at nine in the evening belongs to that day, not to
   * the next one, which is what UTC grouping would say.
   */
  async timesheet(userId: string, from: Date, to: Date): Promise<TimesheetRow[]> {
    const rows = await this.db.execute<{
      day: string;
      seconds: string;
      billable_seconds: string;
    }>(sql`
      SELECT
        to_char(e.started_at AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD') AS day,
        sum(e.duration_seconds)::text AS seconds,
        sum(e.duration_seconds) FILTER (WHERE e.billable)::text AS billable_seconds
      FROM time_entries e
      JOIN task_assignments a ON a.id = e.assignment_id
      WHERE a.user_id = ${userId}
        AND e.started_at >= ${from.toISOString()}::timestamptz
        AND e.started_at < ${to.toISOString()}::timestamptz
        AND e.ended_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);

    return rows.map((row) => ({
      day: row.day,
      seconds: Number(row.seconds ?? 0),
      billableSeconds: Number(row.billable_seconds ?? 0),
    }));
  }

  /**
   * Approved, billable, finished, and not yet on a statement.
   *
   * This is exactly the question a monthly statement asks (FR-31), and every
   * one of those four conditions matters: unapproved time is not ready,
   * unfinished time has no length, and time already billed must not appear
   * twice.
   */
  async unbilledForClient(clientId: string, upTo: Date): Promise<UnbilledTime[]> {
    const rows = await this.db.execute<{
      entry_id: string;
      assignment_id: string;
      client_id: string;
      task_id: string;
      user_id: string;
      started_at: Date;
      duration_seconds: number;
    }>(sql`
      SELECT e.id AS entry_id, e.assignment_id, t.client_id, t.id AS task_id,
             a.user_id, e.started_at, e.duration_seconds
      FROM time_entries e
      JOIN task_assignments a ON a.id = e.assignment_id
      JOIN tasks t ON t.id = a.task_id
      WHERE t.client_id = ${clientId}
        AND e.statement_line_id IS NULL
        AND e.billable
        AND e.approved_at IS NOT NULL
        AND e.ended_at IS NOT NULL
        AND e.ended_at <= ${upTo.toISOString()}::timestamptz
      ORDER BY e.started_at
    `);

    return rows.map((row) => ({
      entryId: row.entry_id,
      assignmentId: row.assignment_id,
      clientId: row.client_id,
      taskId: row.task_id,
      userId: row.user_id,
      startedAt: row.started_at,
      seconds: row.duration_seconds,
    }));
  }

  /**
   * What this person still has to confirm (FR-25).
   *
   * Theirs alone, reached through the assignment. Somebody else cannot vouch
   * for whether you were really working at nine in the evening.
   */
  async awaitingReview(userId: string): Promise<TimeEntry[]> {
    /*
     * Raw SQL, because the join reaches `task_assignments`, which belongs to
     * the services module. Importing its schema here would tie two modules
     * together at compile time for one query; naming the table does not.
     */
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT e.id
      FROM time_entries e
      JOIN task_assignments a ON a.id = e.assignment_id
      WHERE a.user_id = ${userId}
        AND e.review_reason IS NOT NULL
        AND e.reviewed_at IS NULL
      ORDER BY e.started_at
    `);
    if (rows.length === 0) return [];

    const found = await this.db
      .select()
      .from(timeEntries)
      .where(
        inArray(
          timeEntries.id,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(timeEntries.startedAt));

    return found.map((row) => toAggregate(row));
  }

  async save(entry: TimeEntry): Promise<void> {
    this.collector?.collect(entry.pullEvents());
    const state = entry.snapshot();

    const row = {
      id: state.id,
      assignmentId: state.assignmentId,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      source: state.source,
      reason: state.reason,
      billable: state.billable,
      note: state.note,
      reviewReason: state.reviewReason,
      reviewedAt: state.reviewedAt,
      reviewedBy: state.reviewedBy,
      approvedAt: state.approvedAt,
      approvedBy: state.approvedBy,
      statementLineId: state.statementLineId,
    };

    await this.db
      .insert(timeEntries)
      .values(row)
      .onConflictDoUpdate({ target: timeEntries.id, set: row });
  }
}

export class DrizzleRunningTimerRepository implements RunningTimerRepository {
  constructor(private readonly db: Db) {}

  async forUser(userId: string): Promise<RunningTimer | null> {
    const [row] = await this.db
      .select()
      .from(runningTimers)
      .where(eq(runningTimers.userId, userId))
      .limit(1);

    return row
      ? RunningTimer.rehydrate({
          userId: row.userId,
          assignmentId: row.assignmentId,
          startedAt: row.startedAt,
          deviceId: row.deviceId,
          lastSeenAt: row.lastSeenAt,
          heldAt: row.heldAt,
        })
      : null;
  }

  async stale(before: Date): Promise<RunningTimer[]> {
    const rows = await this.db
      .select()
      .from(runningTimers)
      // A held timer has no open span, so there is nothing for the sweep to
      // trim and no reason to forget which task somebody paused.
      .where(and(lt(runningTimers.lastSeenAt, before), isNull(runningTimers.heldAt)));

    return rows.map((row) =>
      RunningTimer.rehydrate({
        userId: row.userId,
        assignmentId: row.assignmentId,
        startedAt: row.startedAt,
        deviceId: row.deviceId,
        lastSeenAt: row.lastSeenAt,
        heldAt: row.heldAt,
      }),
    );
  }

  /**
   * Starting replaces whatever was running.
   *
   * The primary key is the person, so this is an upsert rather than a check
   * followed by an insert. Two devices starting at the same moment cannot both
   * win, which is the race a check-then-insert would lose.
   */
  async start(timer: RunningTimer): Promise<void> {
    const state = timer.snapshot();
    await this.db
      .insert(runningTimers)
      .values(state)
      .onConflictDoUpdate({
        target: runningTimers.userId,
        set: {
          assignmentId: state.assignmentId,
          startedAt: state.startedAt,
          deviceId: state.deviceId,
          lastSeenAt: state.lastSeenAt,
          heldAt: state.heldAt,
        },
      });
  }

  async beat(userId: string, at: Date): Promise<void> {
    await this.db
      .update(runningTimers)
      .set({ lastSeenAt: at })
      .where(eq(runningTimers.userId, userId));
  }

  /** Writes back a held or resumed timer. The row is keyed by the person. */
  async save(timer: RunningTimer): Promise<void> {
    const state = timer.snapshot();
    await this.db
      .update(runningTimers)
      .set({ startedAt: state.startedAt, lastSeenAt: state.lastSeenAt, heldAt: state.heldAt })
      .where(eq(runningTimers.userId, state.userId));
  }

  async clear(userId: string): Promise<void> {
    await this.db.delete(runningTimers).where(eq(runningTimers.userId, userId));
  }
}

function toAggregate(row: typeof timeEntries.$inferSelect): TimeEntry {
  return TimeEntry.rehydrate({
    id: row.id,
    assignmentId: row.assignmentId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    source: row.source as TimeSource,
    reason: row.reason,
    billable: row.billable,
    note: row.note,
    reviewReason: row.reviewReason as ReviewReason | null,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    statementLineId: row.statementLineId,
  });
}
