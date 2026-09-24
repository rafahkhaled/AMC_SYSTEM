import { type CurrencyCode, type EventCollector, Money } from '@amc/kernel';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { QuotationRepository } from '../application/ports.js';
import {
  type LinePricing,
  Quotation,
  type QuotationLine,
  type QuotationState,
} from '../domain/index.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Timestamps out of raw SQL are strings, not Dates.
 *
 * The driver maps a column to a Date only when the query builder told it what
 * the column is. These queries are raw, so a row type claiming Date typechecks
 * and throws `getTime is not a function` the first time a real database
 * answers — which is how this was found once already.
 */
function at(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

type QuotationRow = {
  id: string;
  client_id: string;
  reference: string;
  state: string;
  currency: string;
  valid_until: string | null;
  sent_at: string | null;
  sent_via: string | null;
  link_token_hash: string | null;
  link_expires_at: string | null;
  link_opened_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  notes_en: string | null;
  notes_ar: string | null;
  created_by: string;
  created_at: string;
};

type LineRow = {
  id: string;
  quotation_id: string;
  description_en: string | null;
  description_ar: string | null;
  kind: string;
  hours_centi: number | null;
  per_hour_minor: string | null;
  amount_minor: string | null;
};

function toPricing(row: LineRow, currency: CurrencyCode): LinePricing {
  if (row.kind === 'fixed') {
    return { kind: 'fixed', amount: Money.ofMinor(Number(row.amount_minor ?? 0), currency) };
  }
  return {
    kind: 'hours',
    // Stored as hundredths of an hour so nothing in the billing path is a
    // float, including the quantity.
    hours: (row.hours_centi ?? 0) / 100,
    perHour: Money.ofMinor(Number(row.per_hour_minor ?? 0), currency),
  };
}

export class DrizzleQuotationRepository implements QuotationRepository {
  constructor(
    private readonly db: Db,
    /**
     * Where this aggregate's events go.
     *
     * Absent for a read-only caller and for the expiry sweep's own queries.
     * Present for anything inside a unit of work, which is what turns each
     * event into an audit row in the same transaction as the change.
     */
    private readonly collector?: EventCollector,
  ) {}

  async findById(id: string): Promise<Quotation | null> {
    const rows = await this.db.execute<QuotationRow>(sql`
      SELECT * FROM quotations WHERE id = ${id} LIMIT 1
    `);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async findByReference(reference: string): Promise<Quotation | null> {
    const rows = await this.db.execute<QuotationRow>(sql`
      SELECT * FROM quotations WHERE reference = ${reference} LIMIT 1
    `);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  /**
   * By hash, never by token.
   *
   * The unique index makes this a single-row lookup, so a wrong guess costs
   * the same as a right one and the response time says nothing.
   */
  async findByLinkHash(tokenHash: string): Promise<Quotation | null> {
    const rows = await this.db.execute<QuotationRow>(sql`
      SELECT * FROM quotations WHERE link_token_hash = ${tokenHash} LIMIT 1
    `);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async lapsed(asOf: Date, limit: number): Promise<Quotation[]> {
    const rows = await this.db.execute<QuotationRow>(sql`
      SELECT * FROM quotations
      WHERE state = 'sent' AND valid_until IS NOT NULL AND valid_until < ${asOf.toISOString()}
      ORDER BY valid_until
      LIMIT ${limit}
    `);
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  private async hydrate(row: QuotationRow): Promise<Quotation> {
    const currency = row.currency as CurrencyCode;
    const lineRows = await this.db.execute<LineRow>(sql`
      SELECT * FROM quotation_lines WHERE quotation_id = ${row.id} ORDER BY position
    `);

    const lines: QuotationLine[] = lineRows.map((line) => ({
      id: line.id,
      descriptionEn: line.description_en ?? '',
      descriptionAr: line.description_ar ?? '',
      pricing: toPricing(line, currency),
    }));

    return Quotation.rehydrate({
      id: row.id,
      clientId: row.client_id,
      reference: row.reference,
      state: row.state as QuotationState,
      currency,
      lines,
      // A date column, not a timestamp: read as UTC midnight, which is how
      // every stored calendar day in this system is keyed.
      validUntil: row.valid_until
        ? new Date(`${row.valid_until.slice(0, 10)}T00:00:00.000Z`)
        : null,
      sentAt: at(row.sent_at),
      sentVia: row.sent_via as 'email' | 'by_hand' | null,
      linkTokenHash: row.link_token_hash,
      linkExpiresAt: at(row.link_expires_at),
      linkOpenedAt: at(row.link_opened_at),
      decidedBy: row.decided_by as 'client' | 'staff' | null,
      decidedAt: at(row.decided_at),
      notesEn: row.notes_en,
      notesAr: row.notes_ar,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
    });
  }

  /**
   * Writes the quotation and its lines.
   *
   * The lines are replaced wholesale rather than diffed. A quotation is only
   * editable while it is a draft and has a handful of lines, so working out
   * which changed costs more than rewriting them — and a diff that gets it
   * wrong leaves a line the client was quoted and the firm cannot see.
   */
  async save(quotation: Quotation): Promise<void> {
    this.collector?.collect(quotation.pullEvents());
    const state = quotation.snapshot();

    await this.db.execute(sql`
      INSERT INTO quotations
        (id, client_id, reference, state, currency, valid_until, sent_at, sent_via,
         link_token_hash, link_expires_at, link_opened_at, decided_by,
         decided_at, notes_en, notes_ar, created_by, created_at)
      VALUES (
        ${state.id}, ${state.clientId}, ${state.reference}, ${state.state}, ${state.currency},
        ${state.validUntil ? state.validUntil.toISOString().slice(0, 10) : null},
        ${state.sentAt?.toISOString() ?? null}, ${state.sentVia},
        ${state.linkTokenHash}, ${state.linkExpiresAt?.toISOString() ?? null},
        ${state.linkOpenedAt?.toISOString() ?? null}, ${state.decidedBy},
        ${state.decidedAt?.toISOString() ?? null},
        ${state.notesEn}, ${state.notesAr}, ${state.createdBy},
        ${state.createdAt.toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        state       = excluded.state,
        valid_until = excluded.valid_until,
        sent_at     = excluded.sent_at,
        sent_via    = excluded.sent_via,
        link_token_hash = excluded.link_token_hash,
        link_expires_at = excluded.link_expires_at,
        link_opened_at  = excluded.link_opened_at,
        decided_by      = excluded.decided_by,
        decided_at  = excluded.decided_at,
        notes_en    = excluded.notes_en,
        notes_ar    = excluded.notes_ar
    `);

    await this.db.execute(sql`DELETE FROM quotation_lines WHERE quotation_id = ${state.id}`);

    for (const [position, line] of state.lines.entries()) {
      const pricing = line.pricing;
      await this.db.execute(sql`
        INSERT INTO quotation_lines
          (id, quotation_id, position, description_en, description_ar,
           kind, hours_centi, per_hour_minor, amount_minor)
        VALUES (
          ${line.id}, ${state.id}, ${position},
          ${line.descriptionEn || null}, ${line.descriptionAr || null},
          ${pricing.kind},
          ${pricing.kind === 'hours' ? Math.round(pricing.hours * 100) : null},
          ${pricing.kind === 'hours' ? pricing.perHour.minorUnits : null},
          ${pricing.kind === 'fixed' ? pricing.amount.minorUnits : null}
        )
      `);
    }
  }
}
