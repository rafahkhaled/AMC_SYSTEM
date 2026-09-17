import { type Database, scopePredicate } from '@amc/database';
import type { CalendarScope, DeadlineSource, DueThing, HolidaySource } from '@amc/deadlines';
import type { Holiday } from '@amc/deadlines/domain';
import { at, on } from '@amc/kernel';
import { type SQL, sql } from 'drizzle-orm';

/**
 * Everything with a date on it, gathered from the modules that own those dates.
 *
 * Tasks belong to services and documents to clients. The calendar owns neither
 * and should not learn their tables, so the join lives here — the only place
 * permitted to know about both.
 */
export function deadlineSource(db: Database): DeadlineSource {
  // The shared predicate, so this adapter cannot drift from the repositories.
  const visible = (scope: CalendarScope, column: SQL): SQL => scopePredicate(scope, column);

  interface Row extends Record<string, unknown> {
    id: string;
    kind: DueThing['kind'];
    client_id: string;
    client_name: string;
    subject: string;
    period_key: string | null;
    due_on: string;
    is_done: boolean;
    task_id: string | null;
  }

  const toDueThing = (row: Row): DueThing => ({
    id: row.id,
    kind: row.kind,
    clientId: row.client_id,
    clientName: row.client_name,
    subject: row.subject,
    periodKey: row.period_key,
    // Dates arrive as strings from raw SQL. Read as UTC midnight, which is how
    // every stored calendar day in this system is keyed.
    dueOn: new Date(`${row.due_on.slice(0, 10)}T00:00:00.000Z`),
    isDone: row.is_done,
    taskId: row.task_id,
  });

  /*
   * A task carries the service it is for, and the service says whether the
   * date on it is a statutory filing or ordinary work. That distinction is
   * what lets the screen show a VAT return differently from a bookkeeping job
   * falling due the same week.
   */
  const taskKind = sql`CASE
    WHEN t.service = 'vat_return' THEN 'vat_return'
    WHEN t.service = 'ct_return'  THEN 'ct_return'
    ELSE 'task'
  END`;

  const tasksBetween = (scope: CalendarScope, where: SQL) => sql`
    SELECT t.id, ${taskKind} AS kind, t.client_id, c.legal_name AS client_name,
           t.service AS subject, t.period_key, t.due_at::date::text AS due_on,
           (t.state IN ('completed', 'cancelled')) AS is_done,
           t.id AS task_id
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    WHERE t.due_at IS NOT NULL AND ${where} AND ${visible(scope, sql`t.client_id`)}
  `;

  const documentsBetween = (scope: CalendarScope, where: SQL) => sql`
    SELECT d.id, 'document_expiry' AS kind, d.client_id, c.legal_name AS client_name,
           d.type AS subject, NULL AS period_key, d.expires_on::text AS due_on,
           false AS is_done, NULL AS task_id
    FROM client_documents d
    JOIN clients c ON c.id = d.client_id
    WHERE d.expires_on IS NOT NULL
      AND d.superseded_by_id IS NULL
      AND d.status <> 'required'
      AND ${where} AND ${visible(scope, sql`d.client_id`)}
  `;

  return {
    async between(scope, from, to) {
      if (scope.kind === 'none') return [];
      const rows = await db.execute<Row>(sql`
        ${tasksBetween(
          scope,
          sql`t.due_at >= ${at(from)}::timestamptz AND t.due_at < ${at(to)}::timestamptz`,
        )}
        UNION ALL
        ${documentsBetween(
          scope,
          sql`d.expires_on >= ${on(from)}::date AND d.expires_on < ${on(to)}::date`,
        )}
      `);
      return rows.map(toDueThing);
    },

    async overdue(scope, asOf) {
      if (scope.kind === 'none') return [];
      const today = on(asOf);
      /*
       * Only work that is still open. A return filed late is a fact for the
       * audit log, not something to keep shouting about on a calendar; what
       * belongs here is what somebody still has to do something about.
       */
      const rows = await db.execute<Row>(sql`
        ${tasksBetween(
          scope,
          sql`t.due_at < ${today}::date AND t.state NOT IN ('completed', 'cancelled')`,
        )}
        UNION ALL
        ${documentsBetween(scope, sql`d.expires_on < ${today}::date`)}
        ORDER BY due_on
      `);
      return rows.map(toDueThing);
    },
  };
}

/** The UAE holiday calendar, which is data rather than code because it is lunar. */
export function holidaySource(db: Database): HolidaySource {
  return {
    async between(from, to): Promise<Holiday[]> {
      const rows = await db.execute<{ observed_on: string; name_en: string; name_ar: string }>(sql`
        SELECT observed_on::text, name_en, name_ar
        FROM business_holidays
        WHERE observed_on >= ${on(from)}::date AND observed_on < ${on(to)}::date
      `);
      return rows.map((row) => ({
        date: row.observed_on.slice(0, 10),
        nameEn: row.name_en,
        nameAr: row.name_ar,
      }));
    },
  };
}
