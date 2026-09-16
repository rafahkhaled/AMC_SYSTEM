import type { Database } from '@amc/database';
import type { TaskContextReader } from '@amc/services';
import { sql } from 'drizzle-orm';

/**
 * The names and totals a task board shows but a task does not own.
 *
 * A task knows its client's id, not the company's name; it knows nothing about
 * who is assigned or how long anyone spent. All three live in other modules,
 * so the join lives here, in the only place allowed to know about both.
 *
 * Every method takes the whole page's worth of ids and answers once. The
 * alternative is a query per card, which is how a board that was fast with ten
 * tasks becomes unusable with two hundred.
 */
/** An id list for an IN clause, parameterised rather than interpolated. */
const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

export function taskContext(db: Database): TaskContextReader {
  return {
    async clientNames(clientIds) {
      if (clientIds.length === 0) return new Map();
      const rows = await db.execute<{ id: string; legal_name: string }>(sql`
        SELECT id, legal_name FROM clients WHERE id IN (${list(clientIds)})
      `);
      return new Map(rows.map((row) => [row.id, row.legal_name]));
    },

    async assignees(taskIds) {
      if (taskIds.length === 0) return new Map();
      const rows = await db.execute<{
        task_id: string;
        user_id: string;
        display_name: string;
        role: string;
      }>(sql`
        SELECT a.task_id, a.user_id, u.display_name, a.role
        FROM task_assignments a
        JOIN users u ON u.id = a.user_id
        WHERE a.unassigned_at IS NULL
          AND a.task_id IN (${list(taskIds)})
        ORDER BY a.role, u.display_name
      `);

      const byTask = new Map<string, { userId: string; displayName: string; role: string }[]>();
      for (const row of rows) {
        const list = byTask.get(row.task_id) ?? [];
        list.push({ userId: row.user_id, displayName: row.display_name, role: row.role });
        byTask.set(row.task_id, list);
      }
      return byTask;
    },

    async recordedSeconds(taskIds) {
      if (taskIds.length === 0) return new Map();
      const rows = await db.execute<{ task_id: string; seconds: string | number }>(sql`
        SELECT a.task_id, COALESCE(SUM(e.duration_seconds), 0) AS seconds
        FROM time_entries e
        JOIN task_assignments a ON a.id = e.assignment_id
        WHERE e.ended_at IS NOT NULL
          AND a.task_id IN (${list(taskIds)})
        GROUP BY a.task_id
      `);
      return new Map(rows.map((row) => [row.task_id, Number(row.seconds)]));
    },

    async documentsFor(clientId) {
      /*
       * Only documents actually held, and only the current copy of each.
       *
       * A row with status 'required' is a checklist entry with no file behind
       * it, and a superseded one is the licence that was valid last year.
       * Offering either to satisfy a requirement would let a task start on a
       * document nobody can open.
       */
      const rows = await db.execute<{
        id: string;
        type: string;
        label: string | null;
        original_name: string | null;
        expires_on: string | null;
      }>(sql`
        SELECT id, type, label, original_name, expires_on
        FROM client_documents
        WHERE client_id = ${clientId}
          AND status <> 'required'
          AND superseded_by_id IS NULL
        ORDER BY type
      `);

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.label ?? row.original_name ?? row.type,
        expiresOn: row.expires_on ? new Date(row.expires_on) : null,
      }));
    },
  };
}
