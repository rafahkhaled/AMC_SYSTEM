import type { Clock, CurrencyCode, IdGenerator } from '@amc/kernel';
import { Money } from '@amc/kernel';
import type { Invoice, Quotation, Statement } from '../domain/index.js';
import type {
  BillableWork,
  InvoiceNumbering,
  InvoiceRepository,
  QuotationRepository,
  RateReader,
  StatementRepository,
  UnbilledWorkReader,
  WorkAttachment,
} from './ports.js';

export class FakeClock implements Clock {
  constructor(private at: Date) {}
  now(): Date {
    return this.at;
  }
  set(at: Date): void {
    this.at = at;
  }
}

export class CountingIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class InMemoryStatements implements StatementRepository {
  readonly saved: Statement[] = [];
  private byId = new Map<string, Statement>();

  async findById(id: string): Promise<Statement | null> {
    return this.byId.get(id) ?? null;
  }

  async save(statement: Statement): Promise<void> {
    this.byId.set(statement.id, statement);
    this.saved.push(statement);
  }

  only(): Statement {
    const [first] = [...this.byId.values()];
    if (!first) throw new Error('no statement was created');
    return first;
  }
}

export class InMemoryQuotations implements QuotationRepository {
  private byId = new Map<string, Quotation>();
  private byReference = new Map<string, Quotation>();

  async findById(id: string): Promise<Quotation | null> {
    return this.byId.get(id) ?? null;
  }
  async findByReference(reference: string): Promise<Quotation | null> {
    return this.byReference.get(reference) ?? null;
  }
  async save(quotation: Quotation): Promise<void> {
    this.byId.set(quotation.id, quotation);
    this.byReference.set(quotation.snapshot().reference, quotation);
  }
  async lapsed(asOf: Date): Promise<Quotation[]> {
    return [...this.byId.values()].filter((quotation) => {
      const state = quotation.snapshot();
      return (
        state.state === 'sent' &&
        state.validUntil !== null &&
        state.validUntil.getTime() < asOf.getTime()
      );
    });
  }
}

export class FakeUnbilledWork implements UnbilledWorkReader {
  private work: BillableWork[] = [];

  returning(work: BillableWork[]): this {
    this.work = work;
    return this;
  }

  async forClient(params: { clientId: string; from: Date; to: Date }): Promise<BillableWork[]> {
    return this.work.filter(
      (item) =>
        item.performedOn.getTime() >= params.from.getTime() &&
        item.performedOn.getTime() <= params.to.getTime(),
    );
  }
}

/**
 * Rates by day.
 *
 * Modelled as a list of effective dates rather than one number, because the
 * behaviour worth testing is that two lines on one statement can carry two
 * different rates. A double returning a constant would let that regress
 * silently.
 */
export class FakeRates implements RateReader {
  private currency: CurrencyCode = 'AED';
  private changes: { from: Date; perHour: Money }[] = [
    { from: new Date(0), perHour: Money.ofMinor(30_000, 'AED') },
  ];

  from(changes: { from: Date; perHour: Money }[]): this {
    this.changes = [...changes].sort((a, b) => a.from.getTime() - b.from.getTime());
    return this;
  }

  inCurrency(currency: CurrencyCode): this {
    this.currency = currency;
    return this;
  }

  async perHourOn(_clientId: string, day: Date): Promise<Money> {
    let answer = this.changes[0]?.perHour ?? Money.zero(this.currency);
    for (const change of this.changes) {
      if (change.from.getTime() <= day.getTime()) answer = change.perHour;
    }
    return answer;
  }

  async currencyFor(): Promise<CurrencyCode> {
    return this.currency;
  }
}

export class RecordingAttachment implements WorkAttachment {
  readonly attached: { lineId: string; entryIds: readonly string[] }[] = [];
  readonly released: string[] = [];

  async attach(lineId: string, entryIds: readonly string[]): Promise<void> {
    this.attached.push({ lineId, entryIds });
  }

  async release(entryIds: readonly string[]): Promise<void> {
    this.released.push(...entryIds);
  }
}

export class InMemoryInvoices implements InvoiceRepository {
  readonly saved: Invoice[] = [];
  private byId = new Map<string, Invoice>();
  private byNumber = new Map<string, Invoice>();

  async findById(id: string): Promise<Invoice | null> {
    return this.byId.get(id) ?? null;
  }
  async findByNumber(number: string): Promise<Invoice | null> {
    return this.byNumber.get(number) ?? null;
  }
  async save(invoice: Invoice): Promise<void> {
    this.byId.set(invoice.id, invoice);
    this.byNumber.set(invoice.snapshot().number, invoice);
    this.saved.push(invoice);
  }
  async lateAsOf(asOf: Date): Promise<Invoice[]> {
    return [...this.byId.values()].filter((invoice) => {
      const state = invoice.snapshot();
      return (
        (state.settlement === 'issued' || state.settlement === 'part_paid') &&
        state.dueOn.getTime() < asOf.getTime()
      );
    });
  }
  only(): Invoice {
    const [first] = [...this.byId.values()];
    if (!first) throw new Error('no invoice was raised');
    return first;
  }
}

/**
 * A gapless sequence, per year.
 *
 * Modelled rather than stubbed with a constant, because the thing worth
 * catching is a number handed out twice — and a double returning 'INV-1'
 * forever would make that impossible to see.
 */
export class CountingNumbers implements InvoiceNumbering {
  private issued = new Map<number, number>();

  async next(issuedOn: Date): Promise<string> {
    const year = issuedOn.getUTCFullYear();
    const n = (this.issued.get(year) ?? 0) + 1;
    this.issued.set(year, n);
    return `INV-${year}-${String(n).padStart(4, '0')}`;
  }
}
