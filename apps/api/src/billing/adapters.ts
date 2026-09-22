import type { BillableWork, RateReader, UnbilledWorkReader, WorkAttachment } from '@amc/billing';
import { DrizzleClientRepository } from '@amc/clients/infrastructure';
import type { Database } from '@amc/database';
import { type CurrencyCode, Money, Rate } from '@amc/kernel';
import { sql } from 'drizzle-orm';

/**
 * Joining billing to the work that was actually done.
 *
 * Every function here spans two modules, so none of them may live in either:
 * billing declares what it needs and the composition root supplies it. The
 * same arrangement `project-summaries.ts` uses for the client screens.
 */

/**
 * Which hours are waiting to be billed (FR-31).
 *
 * The four conditions are the whole definition of "unbilled": approved,
 * billable, finished, and not already on a statement. Migration 0011 built a
 * partial index for exactly this question.
 *
 * `performed_on` is the calendar day in Dubai, not the UTC date. Work logged
 * at seven in the evening is the 3rd here and the 3rd in the client's diary;
 * in UTC it is the 3rd until four in the afternoon and the 4th afterwards, so
 * grouping on the raw timestamp would split a single evening across two lines
 * and date half of them wrongly.
 */
export function unbilledWork(db: Database, timeZone: string): UnbilledWorkReader {
  return {
    async forClient({ clientId, from, to }) {
      const rows = await db.execute<{
        entry_id: string;
        project_id: string;
        service: string;
        performed_on: string;
        user_id: string | null;
        seconds: number;
      }>(sql`
        SELECT e.id            AS entry_id,
               t.id            AS project_id,
               t.service       AS service,
               (e.started_at AT TIME ZONE ${timeZone})::date AS performed_on,
               a.user_id       AS user_id,
               e.duration_seconds AS seconds
        FROM time_entries e
        JOIN project_assignments a ON a.id = e.assignment_id
        JOIN projects t            ON t.id = a.project_id
        WHERE t.client_id = ${clientId}
          AND e.statement_line_id IS NULL
          AND e.billable
          AND e.ended_at IS NOT NULL
          AND e.approved_at IS NOT NULL
          AND e.duration_seconds > 0
          AND (e.started_at AT TIME ZONE ${timeZone})::date
              BETWEEN ${from.toISOString().slice(0, 10)}::date
                  AND ${to.toISOString().slice(0, 10)}::date
        ORDER BY performed_on, t.id, a.user_id
      `);

      return rows.map(
        (row): BillableWork => ({
          entryId: row.entry_id,
          projectId: row.project_id,
          service: row.service,
          // A date column: read as UTC midnight, which is how every calendar
          // day in this system is keyed.
          performedOn: new Date(`${row.performed_on.slice(0, 10)}T00:00:00.000Z`),
          userId: row.user_id,
          seconds: Number(row.seconds),
        }),
      );
    },
  };
}

/**
 * What to charge for work done on a day (FR-03).
 *
 * The client aggregate is loaded and asked, rather than `client_rates` being
 * queried here. "The rate that applied that day" is a rule the clients module
 * owns, and a second implementation of it in the billing path is the kind of
 * near-copy that drifts silently and overcharges somebody.
 */
export function rateReader(
  db: Database,
  firmDefault: { perHourMinor: number; currency: CurrencyCode },
): RateReader {
  const fallback = Rate.perHour(Money.ofMinor(firmDefault.perHourMinor, firmDefault.currency));
  const clients = new DrizzleClientRepository(db);

  return {
    async perHourOn(clientId, day) {
      // Billing is a system operation: it bills every client, so it reads
      // every client. Who may *see* a statement is decided on the route.
      const client = await clients.findById(clientId, { kind: 'all' });
      if (!client) return fallback.perHour;
      return client.rateOn(day, fallback).perHour;
    },

    async currencyFor(clientId) {
      const client = await clients.findById(clientId, { kind: 'all' });
      if (!client) return firmDefault.currency;
      return client.rateOn(new Date(), fallback).currency;
    },
  };
}

/**
 * Attaching hours to a statement line, and letting them go again (FR-26).
 *
 * Attaching is what stops an hour being billed twice: once an entry carries a
 * statement line it is invisible to the next generation, and the trigger from
 * migration 0011 freezes it against edits.
 *
 * Releasing is the one permitted undo, and it is why the column is nullable.
 */
/*
 * `sql.param`, not a bare array.
 *
 * Drizzle's template expands a JavaScript array into one placeholder per
 * element — `ANY(($2, $3))` — which Postgres reads as a record and refuses
 * with "cannot cast type record to text[]". `sql.param` binds the whole array
 * as a single value, which postgres.js maps to a Postgres array.
 *
 * It typechecks either way. The difference only appears against a real
 * database, and then only when the list has more than one element.
 */
export function workAttachment(db: Database): WorkAttachment {
  return {
    async attach(lineId, entryIds) {
      if (entryIds.length === 0) return;
      await db.execute(sql`
        UPDATE time_entries
        SET statement_line_id = ${lineId}
        WHERE id = ANY(${sql.param(entryIds)}::text[])
          AND statement_line_id IS NULL
      `);
    },

    async release(entryIds) {
      if (entryIds.length === 0) return;
      await db.execute(sql`
        UPDATE time_entries
        SET statement_line_id = NULL
        WHERE id = ANY(${sql.param(entryIds)}::text[])
      `);
    },
  };
}
