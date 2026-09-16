import type { TaskSummaryReader } from '@amc/clients';
import type { ClientScope } from '@amc/clients/domain';
import type { TaskSummary } from '@amc/contracts';
import type { Database } from '@amc/database';
import { sql } from 'drizzle-orm';

/**
 * Task summaries for the client screens.
 *
 * Lives in the API rather than in either module, because it is the join
 * between them and neither should own it. The clients module declares what it
 * needs; the composition root supplies it.
 */
export function taskSummaries(db: Database): TaskSummaryReader {
  const visible = (scope: ClientScope) => {
    if (scope.kind === 'all') return sql`true`;
    if (scope.kind === 'none') return sql`false`;
    return sql`EXISTS (
      SELECT 1 FROM client_staff_access a
      WHERE a.client_id = t.client_id AND a.user_id = ${scope.userId}
    )`;
  };

  return {
    async forClient(clientId, scope) {
      if (scope.kind === 'none') return [];

      const rows = await db.execute<{
        id: string;
        service: string;
        period_key: string | null;
        state: string;
        due_at: string | null;
        missing: string[] | null;
      }>(sql`
        SELECT t.id, t.service, t.period_key, t.state, t.due_at,
               array_remove(array_agg(d.type) FILTER (
                 WHERE d.mandatory AND d.document_id IS NULL
               ), NULL) AS missing
        FROM tasks t
        LEFT JOIN task_documents d ON d.task_id = t.id
        WHERE t.client_id = ${clientId} AND ${visible(scope)}
        GROUP BY t.id
        ORDER BY t.due_at NULLS LAST, t.created_at DESC
      `);

      const now = Date.now();
      return rows.map(
        (row): TaskSummary => ({
          id: row.id,
          service: row.service,
          periodKey: row.period_key,
          state: row.state,
          dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
          missingDocuments: row.missing ?? [],
          isOverdue:
            row.due_at !== null &&
            !['completed', 'cancelled'].includes(row.state) &&
            new Date(row.due_at).getTime() < now,
        }),
      );
    },

    async openCountsByClient(scope) {
      if (scope.kind === 'none') return new Map();

      const rows = await db.execute<{ client_id: string; open: string }>(sql`
        SELECT t.client_id, count(*)::text AS open
        FROM tasks t
        WHERE t.state NOT IN ('completed', 'cancelled') AND ${visible(scope)}
        GROUP BY t.client_id
      `);

      return new Map(rows.map((row) => [row.client_id, Number(row.open)]));
    },
  };
}
