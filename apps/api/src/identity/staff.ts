import type { Database } from '@amc/database';
import type { StaffReader } from '@amc/identity';
import { at } from '@amc/kernel';
import { sql } from 'drizzle-orm';

/**
 * The staff directory, in one query (X-01).
 *
 * Joins identity's users to the projects and time-tracking tables, which is
 * why it lives in the composition root rather than in the identity module:
 * that module knows who people are, not what they are carrying.
 *
 * One statement rather than four, so every number on a row is as of the same
 * instant. Queries a second apart can show a project as both open and
 * overdue, or as neither.
 */
export function staffReader(db: Database): StaffReader {
  return {
    async all({ thisMonthStart, lastMonthStart, now }) {
      const rows = await db.execute<{
        id: string;
        display_name: string;
        email: string;
        status: string;
        roles: string[] | null;
        starts_at: string | null;
        ends_at: string | null;
        working_days: number[] | null;
        clients: string;
        open_projects: string;
        overdue_projects: string;
        this_month_seconds: string;
        last_month_seconds: string;
      }>(sql`
        SELECT u.id, u.display_name, u.email, u.status,
               (SELECT array_agg(r.role ORDER BY r.role)
                  FROM user_roles r WHERE r.user_id = u.id) AS roles,
               h.starts_at::text, h.ends_at::text, h.working_days,

               -- Distinct clients, not assignments: somebody with four
               -- projects for one client is carrying one relationship.
               (SELECT count(DISTINCT p.client_id)
                  FROM project_assignments a
                  JOIN projects p ON p.id = a.project_id
                 WHERE a.user_id = u.id
                   AND p.state NOT IN ('completed', 'cancelled'))::text AS clients,

               (SELECT count(*)
                  FROM project_assignments a
                  JOIN projects p ON p.id = a.project_id
                 WHERE a.user_id = u.id
                   AND p.state NOT IN ('completed', 'cancelled'))::text AS open_projects,

               (SELECT count(*)
                  FROM project_assignments a
                  JOIN projects p ON p.id = a.project_id
                 WHERE a.user_id = u.id
                   AND p.state NOT IN ('completed', 'cancelled')
                   AND p.due_at < ${at(now)}::timestamptz)::text AS overdue_projects,

               /*
                * Recorded, not approved or billable. This answers "what has
                * this person been doing", and time waiting in an approval
                * queue is still time they worked — the billable figure would
                * show somebody whose week is stuck as having done nothing.
                */
               COALESCE((SELECT sum(e.duration_seconds)
                  FROM time_entries e
                  JOIN project_assignments a ON a.id = e.assignment_id
                 WHERE a.user_id = u.id
                   AND e.ended_at IS NOT NULL
                   AND e.started_at >= ${at(thisMonthStart)}::timestamptz), 0)::text
                 AS this_month_seconds,

               COALESCE((SELECT sum(e.duration_seconds)
                  FROM time_entries e
                  JOIN project_assignments a ON a.id = e.assignment_id
                 WHERE a.user_id = u.id
                   AND e.ended_at IS NOT NULL
                   AND e.started_at >= ${at(lastMonthStart)}::timestamptz
                   AND e.started_at < ${at(thisMonthStart)}::timestamptz), 0)::text
                 AS last_month_seconds

        FROM users u
        LEFT JOIN user_working_hours h ON h.user_id = u.id
        WHERE u.status = 'active'
        ORDER BY u.display_name
      `);

      return rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        status: row.status,
        roles: row.roles ?? [],
        workingHours:
          row.starts_at && row.ends_at
            ? {
                // '09:00:00' is how a time column reads back; the screen wants
                // the clock face, not the seconds.
                startsAt: row.starts_at.slice(0, 5),
                endsAt: row.ends_at.slice(0, 5),
                days: row.working_days ?? [],
              }
            : null,
        clients: Number(row.clients),
        openProjects: Number(row.open_projects),
        overdueProjects: Number(row.overdue_projects),
        thisMonthSeconds: Number(row.this_month_seconds),
        lastMonthSeconds: Number(row.last_month_seconds),
      }));
    },
  };
}
