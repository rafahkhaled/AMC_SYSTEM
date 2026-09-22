import type {
  HoursReport,
  InvoiceView,
  ProfitabilityReport,
  QuotationView,
  StatementView,
} from '@amc/contracts';
import type { Clock } from '@amc/kernel';
import { scopeFor } from '../domain/index.js';
import type { BillingReader, CallerLike, ReportReader } from './ports.js';

/**
 * The billing screens (FR-31, FR-33).
 *
 * Scoped rather than permission-guarded, for the reason every read here is:
 * `clients.view.all` and `clients.view.assigned` belong to different roles, so
 * naming either on a route locks the other out. An accountant sees the
 * statements of the clients they are on; a manager sees all of them.
 */
export class ReadBilling {
  constructor(
    private readonly reader: BillingReader,
    private readonly reports: ReportReader,
    private readonly clock: Clock,
  ) {}

  /**
   * Reports, scoped exactly as the documents are.
   *
   * A report is a faster way to read the same rows, and must not become a way
   * around who may see them: an accountant's hours report covers their own
   * clients and nobody else's.
   */
  async hours(
    caller: CallerLike,
    params: { from: Date; to: Date; by: 'client' | 'person' | 'service' },
  ): Promise<HoursReport> {
    return this.reports.hours(scopeFor(caller), params);
  }

  async profitability(
    caller: CallerLike,
    params: { from: Date; to: Date },
  ): Promise<ProfitabilityReport> {
    return this.reports.profitability(scopeFor(caller), params);
  }

  async quotations(caller: CallerLike, clientId?: string): Promise<QuotationView[]> {
    return this.reader.quotations(scopeFor(caller), clientId ?? null);
  }

  async quotation(caller: CallerLike, id: string): Promise<QuotationView | null> {
    return this.reader.quotation(id, scopeFor(caller));
  }

  async statements(caller: CallerLike, clientId?: string): Promise<StatementView[]> {
    return this.reader.statements(scopeFor(caller), clientId ?? null);
  }

  async statement(caller: CallerLike, id: string): Promise<StatementView | null> {
    return this.reader.statement(id, scopeFor(caller));
  }

  async invoices(caller: CallerLike, options: { outstandingOnly?: boolean } = {}) {
    return this.reader.invoices(scopeFor(caller), {
      outstandingOnly: options.outstandingOnly ?? false,
      asOf: this.clock.now(),
    });
  }

  async invoice(caller: CallerLike, id: string): Promise<InvoiceView | null> {
    return this.reader.invoice(id, scopeFor(caller));
  }
}
