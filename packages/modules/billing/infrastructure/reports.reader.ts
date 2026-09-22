import type { HoursReport, HoursRow, ProfitabilityReport } from '@amc/contracts';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ReportReader } from '../application/ports.js';
import type { BillingScope } from '../domain/index.js';
import { billingVisibleTo } from './visibility.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const money = (minor: number | string, currency = 'AED') => ({
  minorUnits: Number(minor),
  currency,
});

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The reports (FR-35, P2-10 and P2-11).
 *
 * Aggregates in SQL rather than rows in memory. A year of a busy practice is
 * a few hundred thousand time entries, and the honest reason is simpler than
 * performance: summing in the database means the report and the statements
 * agree, because both read the same columns rather than one recomputing what
 * the other stored.
 */
export class DrizzleReportReader implements ReportReader {
  constructor(private readonly db: Db) {}

  /**
   * Recorded hours, split into billed and unbilled.
   *
   * Billed means the entry carries a statement line. That is the same test
   * generation uses to decide what is still owed, so the two can never
   * disagree about which hours are outstanding.
   */
  async hours(
    scope: BillingScope,
    params: { from: Date; to: Date; by: 'client' | 'person' | 'service' },
  ): Promise<HoursReport> {
    const empty: HoursRow = {
      key: 'total',
      label: 'total',
      recordedSeconds: 0,
      billedSeconds: 0,
      unbilledSeconds: 0,
      billedAmount: money(0),
    };

    if (scope.kind === 'none') {
      return { from: day(params.from), to: day(params.to), by: params.by, rows: [], totals: empty };
    }

    /*
     * The grouping column is chosen here rather than by three near-identical
     * queries. It is the only part that varies, and three copies of a join
     * this size is three places to get a later change wrong in two of them.
     */
    const result = await this.db.execute<{
      key: string;
      label: string;
      recorded_seconds: string;
      billed_seconds: string;
      billed_minor: string;
    }>(sql`
      WITH entries AS (
        SELECT e.id,
               e.duration_seconds AS seconds,
               e.statement_line_id,
               p.client_id,
               p.service,
               a.user_id
        FROM time_entries e
        JOIN project_assignments a ON a.id = e.assignment_id
        JOIN projects p            ON p.id = a.project_id
        WHERE e.ended_at IS NOT NULL
          AND e.approved_at IS NOT NULL
          AND e.billable
          AND e.started_at >= ${params.from.toISOString()}
          AND e.started_at < ${params.to.toISOString()}
          AND ${billingVisibleTo(scope, sql`p.client_id`)}
      ),
      -- What each statement line was actually charged, shared across the
      -- entries that make it up so a line is never counted twice.
      charged AS (
        SELECT l.id,
               CASE
                 WHEN l.excluded THEN 0
                 WHEN l.adjusted_to_minor IS NOT NULL THEN l.adjusted_to_minor
                 WHEN l.pricing = 'fixed' THEN coalesce(l.fee_minor, 0)
                 ELSE round((l.worked_seconds::numeric * coalesce(l.per_hour_minor, 0)) / 3600)
               END AS amount_minor
        FROM statement_lines l
      )
      SELECT ${params.by === 'person' ? sql`coalesce(entries.user_id, 'unassigned')` : params.by === 'service' ? sql`entries.service` : sql`entries.client_id`} AS key,
             ${params.by === 'person' ? sql`coalesce(u.display_name, 'Unassigned')` : params.by === 'service' ? sql`entries.service` : sql`c.legal_name`} AS label,
             sum(entries.seconds)::text AS recorded_seconds,
             sum(CASE WHEN entries.statement_line_id IS NOT NULL THEN entries.seconds ELSE 0 END)::text
               AS billed_seconds,
             coalesce(sum(DISTINCT charged.amount_minor), 0)::text AS billed_minor
      FROM entries
      LEFT JOIN charged ON charged.id = entries.statement_line_id
      LEFT JOIN users u  ON u.id = entries.user_id
      LEFT JOIN clients c ON c.id = entries.client_id
      GROUP BY 1, 2
      ORDER BY sum(entries.seconds) DESC
    `);

    const mapped: HoursRow[] = result.map((row) => ({
      key: row.key,
      label: row.label,
      recordedSeconds: Number(row.recorded_seconds),
      billedSeconds: Number(row.billed_seconds),
      unbilledSeconds: Number(row.recorded_seconds) - Number(row.billed_seconds),
      billedAmount: money(row.billed_minor),
    }));

    const totals: HoursRow = {
      key: 'total',
      label: 'total',
      recordedSeconds: mapped.reduce((sum, row) => sum + row.recordedSeconds, 0),
      billedSeconds: mapped.reduce((sum, row) => sum + row.billedSeconds, 0),
      unbilledSeconds: mapped.reduce((sum, row) => sum + row.unbilledSeconds, 0),
      billedAmount: money(mapped.reduce((sum, row) => sum + row.billedAmount.minorUnits, 0)),
    };

    return { from: day(params.from), to: day(params.to), by: params.by, rows: mapped, totals };
  }

  /**
   * What each client is worth (P2-11).
   *
   * The effective hourly rate is the number that matters under a fixed fee:
   * the net fee divided by the hours it took. A practice billing 1,750 for
   * twelve hours earns 145 an hour against a standard rate of 300, and
   * nothing else here says so as plainly.
   *
   * Net, not gross: VAT is collected for the FTA and dividing it into hours
   * would credit the firm with money it is only holding.
   */
  async profitability(
    scope: BillingScope,
    params: { from: Date; to: Date },
  ): Promise<ProfitabilityReport> {
    if (scope.kind === 'none') {
      return { from: day(params.from), to: day(params.to), rows: [] };
    }

    const rows = await this.db.execute<{
      client_id: string;
      client_name: string;
      recorded_seconds: string;
      net_minor: string;
      gross_minor: string;
      paid_minor: string;
      standard_minor: string | null;
      currency: string;
    }>(sql`
      WITH worked AS (
        SELECT p.client_id, sum(e.duration_seconds) AS seconds
        FROM time_entries e
        JOIN project_assignments a ON a.id = e.assignment_id
        JOIN projects p            ON p.id = a.project_id
        WHERE e.ended_at IS NOT NULL
          AND e.approved_at IS NOT NULL
          AND e.billable
          AND e.started_at >= ${params.from.toISOString()}
          AND e.started_at < ${params.to.toISOString()}
        GROUP BY p.client_id
      ),
      -- Per invoice first, then per client: VAT is rounded once on an
      -- invoice's net total, the way the document itself is drawn up, and
      -- rounding each line instead would drift a fils at a time.
      per_invoice AS (
        SELECT i.id, i.client_id, i.currency, i.vat_basis_points,
               sum(l.amount_minor) AS net_minor
        FROM invoices i
        JOIN invoice_lines l ON l.invoice_id = i.id
        WHERE i.settlement <> 'cancelled'
          AND i.issued_on >= ${params.from.toISOString()}
          AND i.issued_on < ${params.to.toISOString()}
        GROUP BY i.id, i.client_id, i.currency, i.vat_basis_points
      ),
      billed AS (
        SELECT client_id,
               currency,
               sum(net_minor) AS net_minor,
               sum(net_minor + round((net_minor * vat_basis_points) / 10000.0)) AS gross_minor
        FROM per_invoice
        GROUP BY client_id, currency
      ),
      received AS (
        SELECT i.client_id, sum(pay.amount_minor) AS paid_minor
        FROM payments pay
        JOIN invoices i ON i.id = pay.invoice_id
        WHERE i.settlement <> 'cancelled'
          AND i.issued_on >= ${params.from.toISOString()}
          AND i.issued_on < ${params.to.toISOString()}
        GROUP BY i.client_id
      ),
      -- The rate in force at the end of the period, as the yardstick.
      standard AS (
        SELECT DISTINCT ON (r.client_id) r.client_id, r.per_hour_minor, r.currency
        FROM client_rates r
        WHERE r.effective_from <= ${day(params.to)}::date
        ORDER BY r.client_id, r.effective_from DESC
      )
      SELECT c.id AS client_id,
             c.legal_name AS client_name,
             coalesce(worked.seconds, 0)::text AS recorded_seconds,
             coalesce(billed.net_minor, 0)::text AS net_minor,
             coalesce(billed.gross_minor, 0)::text AS gross_minor,
             coalesce(received.paid_minor, 0)::text AS paid_minor,
             standard.per_hour_minor::text AS standard_minor,
             coalesce(billed.currency, standard.currency, 'AED') AS currency
      FROM clients c
      LEFT JOIN worked   ON worked.client_id = c.id
      LEFT JOIN billed   ON billed.client_id = c.id
      LEFT JOIN received ON received.client_id = c.id
      LEFT JOIN standard ON standard.client_id = c.id
      WHERE ${billingVisibleTo(scope, sql`c.id`)}
        AND (worked.seconds IS NOT NULL OR billed.net_minor IS NOT NULL)
      ORDER BY coalesce(billed.net_minor, 0) DESC
    `);

    return {
      from: day(params.from),
      to: day(params.to),
      rows: rows.map((row) => {
        const seconds = Number(row.recorded_seconds);
        const net = Number(row.net_minor);
        const gross = Number(row.gross_minor);
        const paid = Number(row.paid_minor);

        return {
          clientId: row.client_id,
          clientName: row.client_name,
          recordedSeconds: seconds,
          netInvoiced: money(net, row.currency),
          grossInvoiced: money(gross, row.currency),
          paid: money(paid, row.currency),
          /*
           * Gross against gross.
           *
           * Comparing the net fee with VAT-inclusive payments made a client
           * who had paid in full look as though they had overpaid by the VAT,
           * and the clamp below hid it by reporting nothing outstanding.
           * Never negative, matching Invoice.balance(): an overpayment is
           * shown as settled rather than as money the firm owes back.
           */
          outstanding: money(Math.max(0, gross - paid), row.currency),
          /*
           * Null rather than a number when no hours were recorded.
           *
           * Dividing by nothing produces a figure that looks like a triumph,
           * and the client it appears against is usually the one nobody has
           * logged time for.
           */
          effectivePerHour:
            seconds > 0 ? money(Math.round((net * 3600) / seconds), row.currency) : null,
          standardPerHour: money(row.standard_minor ?? 0, row.currency),
        };
      }),
    };
  }
}
