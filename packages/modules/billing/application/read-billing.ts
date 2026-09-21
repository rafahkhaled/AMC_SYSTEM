import type { InvoiceView, StatementView } from '@amc/contracts';
import type { Clock } from '@amc/kernel';
import { scopeFor } from '../domain/index.js';
import type { BillingReader, CallerLike } from './ports.js';

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
    private readonly clock: Clock,
  ) {}

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
