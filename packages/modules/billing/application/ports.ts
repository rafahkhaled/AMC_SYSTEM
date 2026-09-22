import type {
  HoursReport,
  InvoiceView,
  ProfitabilityReport,
  QuotationView,
  StatementView,
} from '@amc/contracts';
import type { Conflict, CurrencyCode, Money, Result } from '@amc/kernel';
import type { BillingScope, Invoice, Quotation, Statement } from '../domain/index.js';

export interface QuotationRepository {
  findById(id: string): Promise<Quotation | null>;
  /** The reference is what a client says on the phone. */
  findByReference(reference: string): Promise<Quotation | null>;
  save(quotation: Quotation): Promise<void>;
  /** Sent, past their date, and still waiting — what the expiry sweep asks. */
  lapsed(asOf: Date, limit: number): Promise<Quotation[]>;
}

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  findByNumber(number: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
  /** Unsettled, past their due date — what the overdue sweep asks each morning. */
  lateAsOf(asOf: Date, limit: number): Promise<Invoice[]>;
}

/**
 * The next number on the firm's invoice sequence.
 *
 * A port because the sequence has to be gapless and allocated exactly once,
 * which is a database's job and not an aggregate's. A number allocated twice
 * puts two documents in a client's file under one reference; a gap invites a
 * question from an auditor that nobody can answer.
 *
 * It takes no date: the firm's sequence runs continuously and has never reset
 * at a year boundary.
 */
export interface InvoiceNumbering {
  next(): Promise<string>;
}

/** How the firm bills: VAT rate and payment terms. Configuration, not client data. */
export interface BillingSettings {
  readonly vatBasisPoints: number;
  readonly paymentTermsDays: number;
}

export interface StatementRepository {
  findById(id: string): Promise<Statement | null>;
  save(statement: Statement): Promise<void>;
}

/**
 * One piece of recorded work, ready to be priced.
 *
 * Flat rather than an aggregate, because billing does not own time entries and
 * should not learn their shape. The composition root joins time-tracking's
 * tables to services' and hands over what billing actually needs: whose work,
 * on what project, on which day, for how long.
 */
export interface BillableWork {
  readonly entryId: string;
  readonly projectId: string;
  /** The subscription the project belongs to, which is what a retainer covers. */
  readonly clientServiceId: string;
  readonly service: string;
  /** The calendar day in the firm's timezone, which is what chooses the rate. */
  readonly performedOn: Date;
  readonly userId: string | null;
  readonly seconds: number;
  /**
   * How this work is charged, from the subscription it belongs to.
   *
   * Carried with the work rather than looked up per line, because it decides
   * how the lines are grouped at all: hourly groups by day and person, a fixed
   * fee by project, and a retainer by month.
   */
  readonly pricing: 'hourly' | 'fixed' | 'retainer';
  /** The agreed fee, in minor units. Null when the work is hourly. */
  readonly feeMinor: number | null;
}

/**
 * Which hours are waiting to be billed.
 *
 * Implemented against the index migration 0011 created for exactly this
 * question: approved, billable, finished, and not yet on a statement.
 */
export interface UnbilledWorkReader {
  forClient(params: {
    clientId: string;
    from: Date;
    to: Date;
  }): Promise<BillableWork[]>;
}

/**
 * What to charge for work done on a given day.
 *
 * A port rather than a read of `client_rates`, because the rule for "the rate
 * that day" lives in the clients module and belongs to it. Billing asks; it
 * does not reimplement.
 */
export interface RateReader {
  perHourOn(clientId: string, day: Date): Promise<Money>;
  currencyFor(clientId: string): Promise<CurrencyCode>;
}

/**
 * Attaching hours to a statement line, and letting them go again.
 *
 * Attaching is what stops the same hour being billed twice: once an entry
 * carries a statement line it is invisible to the next generation, and the
 * database freezes it against edits. Releasing is what cancelling a draft
 * statement has to do, or those hours are frozen and attached to nothing —
 * unbillable and invisible, discovered only when somebody adds up a year.
 */
export interface WorkAttachment {
  attach(lineId: string, entryIds: readonly string[]): Promise<void>;
  release(entryIds: readonly string[]): Promise<void>;
}

/** The caller. Re-exported so modules import their ports, not the kernel. */
export type { CallerLike } from '@amc/kernel';
export type { Conflict, Result };

/**
 * The billing screens.
 *
 * A reader rather than a repository: these are joins across five tables that
 * produce views, and rehydrating aggregates in order to throw most of them
 * away would be slower and say less.
 *
 * Out of scope answers as not found, never as forbidden — telling somebody an
 * invoice exists but is not theirs is itself the thing being withheld.
 */
export interface BillingReader {
  quotations(scope: BillingScope, clientId: string | null): Promise<QuotationView[]>;
  quotation(id: string, scope: BillingScope): Promise<QuotationView | null>;
  statements(scope: BillingScope, clientId: string | null): Promise<StatementView[]>;
  statement(id: string, scope: BillingScope): Promise<StatementView | null>;
  invoices(
    scope: BillingScope,
    options: { outstandingOnly: boolean; asOf: Date },
  ): Promise<InvoiceView[]>;
  invoice(id: string, scope: BillingScope): Promise<InvoiceView | null>;
}

/**
 * The reports (FR-35).
 *
 * Separate from BillingReader because it answers a different question with
 * different shapes: that one returns documents, this one returns sums. Both
 * are scoped the same way — a report is a faster way to read the same rows,
 * and must not become a way around who may see them.
 */
export interface ReportReader {
  hours(
    scope: BillingScope,
    params: { from: Date; to: Date; by: 'client' | 'person' | 'service' },
  ): Promise<HoursReport>;
  profitability(
    scope: BillingScope,
    params: { from: Date; to: Date },
  ): Promise<ProfitabilityReport>;
}
