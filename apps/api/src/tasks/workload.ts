import type { Workload } from '@amc/contracts';
import type { Database } from '@amc/database';
import { at } from '@amc/kernel';
import type { WorkloadReader } from '@amc/services';
import { sql } from 'drizzle-orm';

/** The window a person is planning: the week behind and the week ahead. */
const WINDOW_DAYS = 7;

/**
 * Who is on what, joined across three modules.
 *
 * One query rather than one per person. A practice of eight people is small,
 * but the shape that is fine at eight is the shape that is still fine at
 * eighty, and the difference costs nothing to write now.
 */
export function workloadReader(db: Database): WorkloadReader {
  return {
    async read(): Promise<Workload> {
      const now = new Date();
      const weekAhead = new Date(now.getTime() + WINDOW_DAYS * 86_400_000);
      const weekBehind = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

      const rows = await db.execute<{
        user_id: string;
        display_name: string;
        role: string;
        open_tasks: string;
        overdue_tasks: string;
        due_this_week: string;
        recorded_seconds: string;
      }>(sql`
        SELECT u.id AS user_id,
               u.display_name,
               COALESCE(MIN(r.role), 'accountant') AS role,
               COUNT(DISTINCT t.id) FILTER (
                 WHERE t.state NOT IN ('completed', 'cancelled')
               ) AS open_tasks,
               COUNT(DISTINCT t.id) FILTER (
                 WHERE t.state NOT IN ('completed', 'cancelled')
                   AND t.due_at < ${at(now)}::timestamptz
               ) AS overdue_tasks,
               COUNT(DISTINCT t.id) FILTER (
                 WHERE t.state NOT IN ('completed', 'cancelled')
                   AND t.due_at >= ${at(now)}::timestamptz
                   AND t.due_at < ${at(weekAhead)}::timestamptz
               ) AS due_this_week,
               COALESCE(SUM(e.duration_seconds) FILTER (
                 WHERE e.started_at >= ${at(weekBehind)}::timestamptz
               ), 0) AS recorded_seconds
        FROM users u
        LEFT JOIN user_roles r ON r.user_id = u.id
        LEFT JOIN task_assignments a ON a.user_id = u.id AND a.unassigned_at IS NULL
        LEFT JOIN tasks t ON t.id = a.task_id
        LEFT JOIN time_entries e ON e.assignment_id = a.id AND e.ended_at IS NOT NULL
        -- Somebody who has left still owns the hours they recorded, but they
        -- are not a person work can be moved to.
        WHERE u.status = 'active'
        GROUP BY u.id, u.display_name
        ORDER BY open_tasks DESC, u.display_name
      `);

      /*
       * Work nobody is on. Counted separately rather than as a row, because
       * it is not a person's load — it is the thing a manager does something
       * about before looking at anybody's list.
       */
      const [orphans] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM tasks t
        WHERE t.state NOT IN ('completed', 'cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM task_assignments a
            WHERE a.task_id = t.id AND a.unassigned_at IS NULL
          )
      `);

      return {
        people: rows.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          role: row.role,
          openTasks: Number(row.open_tasks),
          overdueTasks: Number(row.overdue_tasks),
          dueThisWeek: Number(row.due_this_week),
          recordedSeconds: Number(row.recorded_seconds),
        })),
        unassignedTasks: Number(orphans?.count ?? 0),
      };
    },
  };
}
