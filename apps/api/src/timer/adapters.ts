import type { TimeEntryView, TimerState } from '@amc/contracts';
import type { Database } from '@amc/database';
import { at } from '@amc/kernel';
import type { AssignmentResolver, TimerViewReader } from '@amc/time-tracking';
import { type SQL, sql } from 'drizzle-orm';

/**
 * Finds the assignment a person books time against, creating one if they are
 * not on the task yet.
 *
 * Joins time-tracking to services, so it lives here rather than in either.
 * Adding the person as a collaborator rather than refusing is the deliberate
 * choice: people help with each other's work, and the alternatives are losing
 * the time or recording it against nobody.
 */
export function assignmentResolver(db: Database, ids: { next(): string }): AssignmentResolver {
  return {
    async forUserOnTask({ userId, taskId, assignedBy }) {
      const [existing] = await db.execute<{ id: string }>(sql`
        SELECT id FROM task_assignments
        WHERE task_id = ${taskId} AND user_id = ${userId} AND unassigned_at IS NULL
        LIMIT 1
      `);
      if (existing) return { assignmentId: existing.id };

      const [task] = await db.execute<{ id: string }>(sql`
        SELECT id FROM tasks WHERE id = ${taskId}
      `);
      if (!task) return null;

      const id = ids.next();
      await db.execute(sql`
        INSERT INTO task_assignments (id, task_id, user_id, role, assigned_by)
        VALUES (${id}, ${taskId}, ${userId}, 'collaborator', ${assignedBy})
      `);
      return { assignmentId: id };
    },
  };
}

/**
 * One query behind both readings of someone's time.
 *
 * The day view and the timesheet differ only in which rows they want, and
 * duplicating the joins would let the two drift — a column added for one and
 * forgotten in the other is exactly how a timesheet ends up disagreeing with
 * the screen it was meant to summarise.
 */
async function readEntries(db: Database, userId: string, where: SQL): Promise<TimeEntryView[]> {
  const rows = await db.execute<{
    id: string;
    task_id: string;
    client_name: string;
    service: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    billable: boolean;
    source: string;
    statement_line_id: string | null;
    review_reason: string | null;
  }>(sql`
    SELECT e.id, t.id AS task_id, c.legal_name AS client_name, t.service,
           e.started_at, e.ended_at, e.duration_seconds, e.billable, e.source,
           e.statement_line_id,
           -- Null once somebody has confirmed it, so the screen shows only
           -- what is still waiting on them.
           CASE WHEN e.reviewed_at IS NULL THEN e.review_reason END AS review_reason
    FROM time_entries e
    JOIN task_assignments a ON a.id = e.assignment_id
    JOIN tasks t ON t.id = a.task_id
    JOIN clients c ON c.id = t.client_id
    WHERE a.user_id = ${userId} AND ${where}
    ORDER BY e.started_at DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    clientName: row.client_name,
    service: row.service,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    seconds: row.duration_seconds,
    billable: row.billable,
    source: row.source as 'timer' | 'manual',
    locked: row.statement_line_id !== null,
    reviewReason: row.review_reason as TimeEntryView['reviewReason'],
  }));
}

/** What the timer screen shows: the running timer and today's entries. */
export function timerViewReader(db: Database): TimerViewReader {
  return {
    async running(userId): Promise<TimerState['running']> {
      const [row] = await db.execute<{
        task_id: string;
        assignment_id: string;
        client_id: string;
        client_name: string;
        service: string;
        started_at: string;
        held_at: string | null;
        today_on_task_seconds: string | number;
      }>(sql`
        SELECT t.id AS task_id, r.assignment_id, t.client_id, c.legal_name AS client_name,
               t.service, r.started_at, r.held_at,
               -- What has already been banked on this task today, which is the
               -- figure somebody wants when they come back to a held job. The
               -- day is Dubai's, because a working day is local.
               COALESCE((
                 SELECT SUM(e.duration_seconds)
                 FROM time_entries e
                 JOIN task_assignments ea ON ea.id = e.assignment_id
                 WHERE ea.task_id = t.id
                   AND ea.user_id = r.user_id
                   AND e.ended_at IS NOT NULL
                   AND (e.started_at AT TIME ZONE 'Asia/Dubai')::date
                       = (now() AT TIME ZONE 'Asia/Dubai')::date
               ), 0) AS today_on_task_seconds
        FROM running_timers r
        JOIN task_assignments a ON a.id = r.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN clients c ON c.id = t.client_id
        WHERE r.user_id = ${userId}
      `);
      if (!row) return null;

      const startedAt = new Date(row.started_at);
      const held = row.held_at !== null;
      return {
        taskId: row.task_id,
        assignmentId: row.assignment_id,
        clientId: row.client_id,
        clientName: row.client_name,
        service: row.service,
        startedAt: startedAt.toISOString(),
        // Counted on the server. A tab left open overnight would otherwise
        // show whatever its own clock had drifted to. A held timer counts
        // nothing, because its span was closed when the hold began.
        elapsedSeconds: held
          ? 0
          : Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
        held,
        todayOnTaskSeconds: Number(row.today_on_task_seconds ?? 0),
      };
    },

    async entriesOn(userId, day) {
      // The person's own day in Dubai, not the server's day in UTC.
      return readEntries(
        db,
        userId,
        sql`(e.started_at AT TIME ZONE 'Asia/Dubai')::date
            = (${at(day)}::timestamptz AT TIME ZONE 'Asia/Dubai')::date`,
      );
    },

    async entriesBetween(userId, from, to) {
      return readEntries(
        db,
        userId,
        sql`e.started_at >= ${at(from)}::timestamptz AND e.started_at < ${at(to)}::timestamptz`,
      );
    },
  };
}
