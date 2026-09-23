import type { InvoiceView, QuotationView, StatementView } from '@amc/contracts';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { BillingReader } from '../application/ports.js';
import type { BillingScope } from '../domain/index.js';
import { billingVisibleTo } from './visibility.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const money = (minor: number | string, currency: string) => ({
  minorUnits: Number(minor),
  currency,
});

type StatementRow = {
  id: string;
  client_id: string;
  client_name: string | null;
  period_start: string;
  period_end: string;
  state: string;
  currency: string;
  approved_at: string | null;
  approved_by_name: string | null;
  created_at: string;
};

type LineRow = {
  id: string;
  statement_id: string;
  project_id: string;
  service: string;
  performed_on: string;
  user_id: string | null;
  user_name: string | null;
  worked_seconds: number;
  pricing: string;
  per_hour_minor: string | null;
  fee_minor: string | null;
  excluded: boolean;
  excluded_reason: string | null;
  adjusted_to_minor: string | null;
  adjusted_reason: string | null;
};

/**
 * What a line is worth, worked out in SQL's absence.
 *
 * The same rule as `lineAmount` in the domain, and the reason it is not shared
 * is that the domain deals in Money and this deals in the wire's plain
 * integers. Both round the same way because neither rounds at all: seconds
 * times fils divided by 3600, as whole numbers, half away from zero.
 */
function amountOf(line: LineRow): number {
  if (line.excluded) return 0;
  if (line.adjusted_to_minor !== null) return Number(line.adjusted_to_minor);
  return asWorked(line);
}

function asWorked(line: LineRow): number {
  // A fee is the amount. There is no rate to multiply by, and inventing one
  // from the hours would move every time somebody recorded more time.
  if (line.pricing === 'fixed') return Number(line.fee_minor ?? 0);

  const product = BigInt(line.worked_seconds) * BigInt(line.per_hour_minor ?? 0);
  const hour = 3600n;
  const whole = product / hour;
  const remainder = product % hour;
  // Half away from zero, the one rounding rule in this system.
  return Number(remainder * 2n >= hour ? whole + 1n : whole);
}

export class DrizzleBillingReader implements BillingReader {
  constructor(private readonly db: Db) {}

  async quotations(scope: BillingScope, clientId: string | null): Promise<QuotationView[]> {
    if (scope.kind === 'none') return [];

    const rows = await this.db.execute<QuotationRow>(sql`
      ${QUOTATION_SELECT}
      WHERE ${billingVisibleTo(scope, sql`q.client_id`)}
        AND (${clientId}::text IS NULL OR q.client_id = ${clientId})
      ORDER BY q.created_at DESC
      LIMIT 200
    `);
    return this.withLines(rows);
  }

  async quotation(id: string, scope: BillingScope): Promise<QuotationView | null> {
    if (scope.kind === 'none') return null;

    const rows = await this.db.execute<QuotationRow>(sql`
      ${QUOTATION_SELECT}
      WHERE q.id = ${id} AND ${billingVisibleTo(scope, sql`q.client_id`)}
      LIMIT 1
    `);
    const [quotation] = await this.withLines(rows);
    return quotation ?? null;
  }

  private async withLines(rows: readonly QuotationRow[]): Promise<QuotationView[]> {
    if (rows.length === 0) return [];

    const lineRows = await this.db.execute<QuotationLineRow>(sql`
      SELECT * FROM quotation_lines
      WHERE quotation_id = ANY(${sql.param(rows.map((row) => row.id))}::text[])
      ORDER BY quotation_id, position
    `);

    return rows.map((row) => {
      const currency = row.currency;
      const lines = lineRows
        .filter((line) => line.quotation_id === row.id)
        .map((line) => {
          // Hundredths of an hour, whole, so nothing in the billing path is a
          // float — including the quantity.
          const hours = line.hours_centi === null ? null : line.hours_centi / 100;
          const amount =
            line.kind === 'fixed'
              ? Number(line.amount_minor ?? 0)
              : roundHalfAway(
                  BigInt(line.hours_centi ?? 0) * BigInt(line.per_hour_minor ?? 0),
                  100n,
                );

          return {
            id: line.id,
            descriptionEn: line.description_en ?? '',
            descriptionAr: line.description_ar ?? '',
            kind: line.kind as 'hours' | 'fixed',
            hours,
            perHour: line.per_hour_minor === null ? null : money(line.per_hour_minor, currency),
            amount: money(amount, currency),
          };
        });

      return {
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        reference: row.reference,
        state: row.state as QuotationView['state'],
        currency,
        lines,
        total: money(
          lines.reduce((sum, line) => sum + line.amount.minorUnits, 0),
          currency,
        ),
        validUntil: row.valid_until ? row.valid_until.slice(0, 10) : null,
        sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
        sentVia: row.sent_via as 'email' | 'by_hand' | null,
        decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
        notesEn: row.notes_en,
        notesAr: row.notes_ar,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  async statements(scope: BillingScope, clientId: string | null): Promise<StatementView[]> {
    if (scope.kind === 'none') return [];

    const rows = await this.db.execute<StatementRow>(sql`
      SELECT s.id, s.client_id, c.legal_name AS client_name,
             s.period_start, s.period_end, s.state, s.currency,
             s.approved_at, u.display_name AS approved_by_name, s.created_at
      FROM statements s
      JOIN clients c      ON c.id = s.client_id
      LEFT JOIN users u   ON u.id = s.approved_by
      WHERE ${billingVisibleTo(scope, sql`s.client_id`)}
        AND (${clientId}::text IS NULL OR s.client_id = ${clientId})
      ORDER BY s.period_end DESC, s.created_at DESC
      LIMIT 200
    `);
    if (rows.length === 0) return [];

    const lines = await this.linesFor(rows.map((row) => row.id));
    return rows.map((row) => this.toStatement(row, lines.get(row.id) ?? []));
  }

  async statement(id: string, scope: BillingScope): Promise<StatementView | null> {
    if (scope.kind === 'none') return null;

    const rows = await this.db.execute<StatementRow>(sql`
      SELECT s.id, s.client_id, c.legal_name AS client_name,
             s.period_start, s.period_end, s.state, s.currency,
             s.approved_at, u.display_name AS approved_by_name, s.created_at
      FROM statements s
      JOIN clients c    ON c.id = s.client_id
      LEFT JOIN users u ON u.id = s.approved_by
      WHERE s.id = ${id} AND ${billingVisibleTo(scope, sql`s.client_id`)}
      LIMIT 1
    `);
    const row = rows[0];
    // Out of scope and not there answer alike.
    if (!row) return null;

    const lines = await this.linesFor([row.id]);
    return this.toStatement(row, lines.get(row.id) ?? []);
  }

  /**
   * Drizzle expands a bare array into one placeholder per element, which
   * Postgres reads as a record and refuses. `sql.param` binds it as a single
   * array value. It typechecks either way; the difference appears only against
   * a real database, and only when the list has more than one element.
   */
  private async linesFor(statementIds: readonly string[]): Promise<Map<string, LineRow[]>> {
    const rows = await this.db.execute<LineRow>(sql`
      SELECT l.*, u.display_name AS user_name
      FROM statement_lines l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.statement_id = ANY(${sql.param(statementIds)}::text[])
      ORDER BY l.statement_id, l.position
    `);

    const grouped = new Map<string, LineRow[]>();
    for (const row of rows) {
      const existing = grouped.get(row.statement_id);
      if (existing) existing.push(row);
      else grouped.set(row.statement_id, [row]);
    }
    return grouped;
  }

  private toStatement(row: StatementRow, lines: readonly LineRow[]): StatementView {
    const currency = row.currency;
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      periodStart: row.period_start.slice(0, 10),
      periodEnd: row.period_end.slice(0, 10),
      state: row.state as StatementView['state'],
      currency,
      lines: lines.map((line) => ({
        id: line.id,
        projectId: line.project_id,
        service: line.service,
        performedOn: line.performed_on.slice(0, 10),
        userId: line.user_id,
        userName: line.user_name,
        workedSeconds: line.worked_seconds,
        pricing: line.pricing === 'fixed' ? 'fixed' : 'hourly',
        perHour: line.per_hour_minor === null ? null : money(line.per_hour_minor, currency),
        asWorked: money(asWorked(line), currency),
        amount: money(amountOf(line), currency),
        excluded: line.excluded,
        excludedReason: line.excluded_reason,
        adjustedTo:
          line.adjusted_to_minor === null ? null : money(line.adjusted_to_minor, currency),
        adjustedReason: line.adjusted_reason,
      })),
      totalAsWorked: money(
        lines.reduce((total, line) => total + asWorked(line), 0),
        currency,
      ),
      total: money(
        lines.reduce((total, line) => total + amountOf(line), 0),
        currency,
      ),
      workedSeconds: lines.reduce((total, line) => total + line.worked_seconds, 0),
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      approvedBy: row.approved_by_name,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async invoices(
    scope: BillingScope,
    options: { outstandingOnly: boolean; asOf: Date },
  ): Promise<InvoiceView[]> {
    if (scope.kind === 'none') return [];

    const rows = await this.db.execute<InvoiceRow>(sql`
      ${INVOICE_SELECT}
      WHERE ${billingVisibleTo(scope, sql`i.client_id`)}
        AND (${options.outstandingOnly} = false
             OR i.settlement IN ('issued', 'part_paid'))
      ORDER BY i.issued_on DESC
      LIMIT 200
    `);
    return this.withDetail(rows);
  }

  async invoice(id: string, scope: BillingScope): Promise<InvoiceView | null> {
    if (scope.kind === 'none') return null;

    const rows = await this.db.execute<InvoiceRow>(sql`
      ${INVOICE_SELECT}
      WHERE i.id = ${id} AND ${billingVisibleTo(scope, sql`i.client_id`)}
      LIMIT 1
    `);
    const [invoice] = await this.withDetail(rows);
    return invoice ?? null;
  }

  private async withDetail(rows: readonly InvoiceRow[]): Promise<InvoiceView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const lineRows = await this.db.execute<InvoiceLineRow>(sql`
      SELECT * FROM invoice_lines WHERE invoice_id = ANY(${sql.param(ids)}::text[])
      ORDER BY invoice_id, position
    `);
    const paymentRows = await this.db.execute<PaymentRow>(sql`
      SELECT * FROM payments WHERE invoice_id = ANY(${sql.param(ids)}::text[])
      ORDER BY invoice_id, received_on, id
    `);

    return rows.map((row) => {
      const currency = row.currency;
      const lines = lineRows.filter((line) => line.invoice_id === row.id);
      const payments = paymentRows.filter((payment) => payment.invoice_id === row.id);

      const net = lines.reduce((total, line) => total + Number(line.amount_minor), 0);
      // Basis points of a whole number, rounded half away from zero, as the
      // kernel does it. Nothing here is ever a float.
      const vat = Math.round((net * row.vat_basis_points) / 10_000);
      const total = net + vat;
      const paid = payments.reduce((sum, payment) => sum + Number(payment.amount_minor), 0);

      return {
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        statementId: row.statement_id,
        number: row.number,
        status: statusOf(row),
        settlement: row.settlement as InvoiceView['settlement'],
        currency,
        lines: lines.map((line) => ({
          id: line.id,
          projectId: line.project_id,
          service: line.service,
          descriptionEn: line.description_en,
          descriptionAr: line.description_ar,
          workedSeconds: line.worked_seconds,
          amount: money(line.amount_minor, currency),
          quantityCenti: line.quantity_centi,
          unitRate: line.unit_minor === null ? null : money(line.unit_minor, currency),
        })),
        payments: payments.map((payment) => ({
          id: payment.id,
          amount: money(payment.amount_minor, currency),
          receivedOn: new Date(payment.received_on).toISOString(),
          method: payment.method,
          reference: payment.reference,
          recordedBy: payment.recorded_by_name ?? payment.recorded_by,
        })),
        vatBasisPoints: row.vat_basis_points,
        net: money(net, currency),
        vat: money(vat, currency),
        total: money(total, currency),
        paid: money(paid, currency),
        balance: money(Math.max(0, total - paid), currency),
        issuedOn: new Date(row.issued_on).toISOString(),
        dueOn: new Date(row.due_on).toISOString(),
        overdueSince: row.overdue_since ? new Date(row.overdue_since).toISOString() : null,
        collectionPending: pendingCollection(row),
        openProjects: pendingCollection(row) ? Number(row.open_projects) : 0,
      };
    });
  }
}

/**
 * One word for a screen.
 *
 * The same collapse the aggregate makes: lateness beats part payment, because
 * the reason anybody opens this list is to decide who to chase.
 */
/**
 * The existing-client exception being exercised (FR-34).
 *
 * Money owed, and the firm still working. An overdue invoice is deliberately
 * not included: once it is late it belongs to collections, and calling it
 * "collection pending" there would hide the harder fact behind a softer word.
 */
function pendingCollection(row: InvoiceRow): boolean {
  if (row.settlement !== 'issued' && row.settlement !== 'part_paid') return false;
  if (row.overdue_since) return false;
  return Number(row.open_projects) > 0;
}

function statusOf(row: InvoiceRow): InvoiceView['status'] {
  if (row.settlement === 'cancelled') return 'cancelled';
  if (row.settlement === 'paid') return 'paid';
  if (row.overdue_since) return 'overdue';
  return row.settlement as 'issued' | 'part_paid';
}

const INVOICE_SELECT = sql`
  SELECT i.id, i.client_id, c.legal_name AS client_name, i.statement_id, i.number,
         i.settlement, i.currency, i.vat_basis_points,
         i.issued_on, i.due_on, i.overdue_since,
         /*
          * Work still open for this client (FR-34).
          *
          * Counted per client rather than per invoice because that is the
          * question: the firm is carrying on for somebody who has not paid,
          * and which of their projects happens to be behind which invoice
          * does not change the decision.
          */
         (SELECT count(*) FROM projects p
           WHERE p.client_id = i.client_id
             AND p.state NOT IN ('completed', 'cancelled'))::text AS open_projects
  FROM invoices i
  JOIN clients c ON c.id = i.client_id
`;

type InvoiceRow = {
  id: string;
  client_id: string;
  client_name: string | null;
  statement_id: string;
  number: string;
  settlement: string;
  currency: string;
  vat_basis_points: number;
  issued_on: string;
  due_on: string;
  overdue_since: string | null;
  open_projects: string;
};

type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  project_id: string;
  service: string;
  description_en: string;
  description_ar: string;
  worked_seconds: number;
  amount_minor: string;
  quantity_centi: number;
  unit_minor: string | null;
};

type PaymentRow = {
  id: string;
  invoice_id: string;
  amount_minor: string;
  received_on: string;
  method: string;
  reference: string | null;
  recorded_by: string;
  recorded_by_name: string | null;
};

/** Half away from zero, the one rounding rule in this system. */
function roundHalfAway(product: bigint, divisor: bigint): number {
  const whole = product / divisor;
  const remainder = product % divisor;
  return Number(remainder * 2n >= divisor ? whole + 1n : whole);
}

const QUOTATION_SELECT = sql`
  SELECT q.id, q.client_id, c.legal_name AS client_name, q.reference, q.state,
         q.currency, q.valid_until, q.sent_at, q.sent_via, q.decided_at,
         q.notes_en, q.notes_ar, q.created_at
  FROM quotations q
  JOIN clients c ON c.id = q.client_id
`;

type QuotationRow = {
  id: string;
  client_id: string;
  client_name: string | null;
  reference: string;
  state: string;
  currency: string;
  valid_until: string | null;
  sent_at: string | null;
  sent_via: string | null;
  decided_at: string | null;
  notes_en: string | null;
  notes_ar: string | null;
  created_at: string;
};

type QuotationLineRow = {
  id: string;
  quotation_id: string;
  description_en: string | null;
  description_ar: string | null;
  kind: string;
  hours_centi: number | null;
  per_hour_minor: string | null;
  amount_minor: string | null;
};
