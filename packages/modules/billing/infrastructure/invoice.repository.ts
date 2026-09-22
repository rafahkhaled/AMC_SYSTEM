import { type CurrencyCode, Duration, Money } from '@amc/kernel';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { InvoiceNumbering, InvoiceRepository } from '../application/ports.js';
import { Invoice, type InvoiceLine, type Payment, type Settlement } from '../domain/index.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

function at(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

type InvoiceRow = {
  id: string;
  client_id: string;
  statement_id: string;
  number: string;
  settlement: string;
  currency: string;
  vat_basis_points: number;
  issued_on: string;
  due_on: string;
  overdue_since: string | null;
  issued_by: string;
  notes_en: string | null;
  notes_ar: string | null;
};

type LineRow = {
  id: string;
  project_id: string;
  service: string;
  description_en: string;
  description_ar: string;
  worked_seconds: number;
  amount_minor: string;
};

type PaymentRow = {
  id: string;
  amount_minor: string;
  received_on: string;
  method: string;
  reference: string | null;
  recorded_by: string;
};

export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Invoice | null> {
    const rows = await this.db.execute<InvoiceRow>(sql`
      SELECT * FROM invoices WHERE id = ${id} LIMIT 1
    `);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async findByNumber(number: string): Promise<Invoice | null> {
    const rows = await this.db.execute<InvoiceRow>(sql`
      SELECT * FROM invoices WHERE number = ${number} LIMIT 1
    `);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async lateAsOf(asOf: Date, limit: number): Promise<Invoice[]> {
    const rows = await this.db.execute<InvoiceRow>(sql`
      SELECT * FROM invoices
      WHERE settlement IN ('issued', 'part_paid')
        AND due_on < ${asOf.toISOString()}
      ORDER BY due_on
      LIMIT ${limit}
    `);
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  private async hydrate(row: InvoiceRow): Promise<Invoice> {
    const currency = row.currency as CurrencyCode;

    const lineRows = await this.db.execute<LineRow>(sql`
      SELECT * FROM invoice_lines WHERE invoice_id = ${row.id} ORDER BY position
    `);
    const paymentRows = await this.db.execute<PaymentRow>(sql`
      SELECT * FROM payments WHERE invoice_id = ${row.id} ORDER BY received_on, id
    `);

    const lines: InvoiceLine[] = lineRows.map((line) => ({
      id: line.id,
      projectId: line.project_id,
      service: line.service,
      descriptionEn: line.description_en,
      descriptionAr: line.description_ar,
      worked: Duration.ofSeconds(line.worked_seconds),
      amount: Money.ofMinor(Number(line.amount_minor), currency),
    }));

    const payments: Payment[] = paymentRows.map((payment) => ({
      id: payment.id,
      amount: Money.ofMinor(Number(payment.amount_minor), currency),
      receivedOn: new Date(payment.received_on),
      method: payment.method,
      reference: payment.reference,
      recordedBy: payment.recorded_by,
    }));

    return Invoice.rehydrate({
      id: row.id,
      clientId: row.client_id,
      statementId: row.statement_id,
      number: row.number,
      settlement: row.settlement as Settlement,
      currency,
      lines,
      payments,
      vatBasisPoints: row.vat_basis_points,
      issuedOn: new Date(row.issued_on),
      dueOn: new Date(row.due_on),
      overdueSince: at(row.overdue_since),
      issuedBy: row.issued_by,
      notesEn: row.notes_en,
      notesAr: row.notes_ar,
    });
  }

  /**
   * Writes the invoice, its lines and its payments.
   *
   * Lines are inserted once and never updated: an invoice is frozen at issue,
   * so a line that changed would mean the document in the client's file and
   * the one in here had diverged. `ON CONFLICT DO NOTHING` says that plainly —
   * a second save of the same invoice rewrites its settlement and adds any new
   * payment, and leaves the billed lines exactly as they were.
   */
  async save(invoice: Invoice): Promise<void> {
    const state = invoice.snapshot();

    await this.db.execute(sql`
      INSERT INTO invoices
        (id, client_id, statement_id, number, settlement, currency,
         vat_basis_points, issued_on, due_on, overdue_since, issued_by,
         notes_en, notes_ar)
      VALUES (
        ${state.id}, ${state.clientId}, ${state.statementId}, ${state.number},
        ${state.settlement}, ${state.currency}, ${state.vatBasisPoints},
        ${state.issuedOn.toISOString()}, ${state.dueOn.toISOString()},
        ${state.overdueSince?.toISOString() ?? null}, ${state.issuedBy},
        ${state.notesEn}, ${state.notesAr}
      )
      ON CONFLICT (id) DO UPDATE SET
        settlement    = excluded.settlement,
        overdue_since = excluded.overdue_since,
        notes_en      = excluded.notes_en,
        notes_ar      = excluded.notes_ar
    `);

    for (const [position, line] of state.lines.entries()) {
      await this.db.execute(sql`
        INSERT INTO invoice_lines
          (id, invoice_id, project_id, service, description_en, description_ar,
           worked_seconds, amount_minor, position)
        VALUES (
          ${line.id}, ${state.id}, ${line.projectId}, ${line.service},
          ${line.descriptionEn}, ${line.descriptionAr},
          ${line.worked.seconds}, ${line.amount.minorUnits}, ${position}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }

    for (const payment of state.payments) {
      await this.db.execute(sql`
        INSERT INTO payments
          (id, invoice_id, amount_minor, currency, received_on, method, reference, recorded_by)
        VALUES (
          ${payment.id}, ${state.id}, ${payment.amount.minorUnits}, ${state.currency},
          ${payment.receivedOn.toISOString()}, ${payment.method},
          ${payment.reference}, ${payment.recordedBy}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }
  }
}

/**
 * The next invoice number, allocated by the database.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` takes a row lock for the
 * year and hands back a value nobody else can receive. Reading the highest
 * number and adding one would give two people the same answer under any
 * concurrency at all, and an invoice number handed out twice cannot be undone:
 * the client has both documents.
 */
export class DrizzleInvoiceNumbering implements InvoiceNumbering {
  constructor(private readonly db: Db) {}

  async next(issuedOn: Date): Promise<string> {
    const year = issuedOn.getUTCFullYear();
    const rows = await this.db.execute<{ next_value: number }>(sql`
      INSERT INTO invoice_numbers (year, next_value)
      VALUES (${year}, 2)
      ON CONFLICT (year) DO UPDATE SET
        next_value = invoice_numbers.next_value + 1,
        updated_at = now()
      RETURNING invoice_numbers.next_value - 1 AS next_value
    `);

    const value = rows[0]?.next_value;
    if (value === undefined) {
      throw new Error('The invoice sequence did not return a number');
    }
    return `INV-${year}-${String(value).padStart(4, '0')}`;
  }
}
