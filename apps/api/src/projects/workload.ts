import type { Workload } from '@amc/contracts';
import type { Database } from '@amc/database';
import { at } from '@amc/kernel';
import type { WorkloadReader } from '@amc/projects';
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
        open_projects: string;
        overdue_projects: string;
        due_this_week: string;
        recorded_seconds: string;
      }>(sql`
        SELECT u.id AS user_id,
               u.display_name,
               COALESCE(MIN(r.role), 'accountant') AS role,
               COUNT(DISTINCT t.id) FILTER (
                 WHERE t.state NOT IN ('completed', 'cancelled')
               ) AS open_projects,
               COUNT(DISTINCT t.id) FILTER (
                 WHERE t.state NOT IN ('completed', 'cancelled')
                   AND t.due_at < ${at(now)}::timestamptz
               ) AS overdue_projects,
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
        LEFT JOIN project_assignments a ON a.user_id = u.id AND a.unassigned_at IS NULL
        LEFT JOIN projects t ON t.id = a.project_id
        LEFT JOIN time_entries e ON e.assignment_id = a.id AND e.ended_at IS NOT NULL
        -- Somebody who has left still owns the hours they recorded, but they
        -- are not a person work can be moved to.
        WHERE u.status = 'active'
        GROUP BY u.id, u.display_name
        ORDER BY open_projects DESC, u.display_name
      `);

      /*
       * Work nobody is on. Counted separately rather than as a row, because
       * it is not a person's load — it is the thing a manager does something
       * about before looking at anybody's list.
       */
      const [orphans] = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM projects t
        WHERE t.state NOT IN ('completed', 'cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM project_assignments a
            WHERE a.project_id = t.id AND a.unassigned_at IS NULL
          )
      `);

      return {
        people: rows.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          role: row.role,
          openProjects: Number(row.open_projects),
          overdueProjects: Number(row.overdue_projects),
          dueThisWeek: Number(row.due_this_week),
          recordedSeconds: Number(row.recorded_seconds),
        })),
        unassignedProjects: Number(orphans?.count ?? 0),
      };
    },
  };
}
