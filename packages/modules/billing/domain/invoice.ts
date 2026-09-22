import {
  AggregateRoot,
  Conflict,
  type CurrencyCode,
  Duration,
  Money,
  type Result,
  domainEvent,
  err,
  ok,
} from '@amc/kernel';

/**
 * An invoice (FR-32, FR-33).
 *
 * Raised from an approved statement and frozen at that moment. Its lines are
 * copies, not references: the statement can be reopened, a rate can change, a
 * project can be renamed, and none of it may alter a document the client has
 * already been sent. What was billed must stay what was billed.
 *
 * Every line carries a `projectId` and there is no way to add one without it.
 * That is ERD rule 4 — nothing bills without a project — and it is the column
 * that makes a line defensible three years later when somebody asks what it
 * was for.
 */

/**
 * How far an invoice has been settled.
 *
 * Deliberately separate from whether it is overdue. An invoice can be part
 * paid *and* two weeks late, and a single status field forces a choice between
 * recording one fact or the other — which means a report showing "overdue"
 * either hides the payment or the lateness. Both are kept, and `status()`
 * collapses them only for display.
 */
export type Settlement = 'issued' | 'part_paid' | 'paid' | 'cancelled';

export interface InvoiceLine {
  readonly id: string;
  /** Never null. Nothing bills without a project. */
  readonly projectId: string;
  readonly service: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly worked: Duration;
  readonly amount: Money;
  /**
   * What the document's Qty and Rate columns print.
   *
   * Hundredths of a unit, so 250 is two and a half hours and 100 is one fixed
   * fee. Carried rather than worked out at print time, because the client
   * holds a piece of paper and it has to keep saying what it said even after
   * the rate changes.
   *
   * `unitRate` is null only for a line from before these were recorded.
   */
  readonly quantityCenti: number;
  readonly unitRate: Money | null;
}

export interface Payment {
  readonly id: string;
  readonly amount: Money;
  readonly receivedOn: Date;
  readonly method: string;
  readonly reference: string | null;
  readonly recordedBy: string;
}

export interface InvoiceSnapshot {
  readonly id: string;
  readonly clientId: string;
  readonly statementId: string;
  /** The number on the document the client files. */
  readonly number: string;
  readonly settlement: Settlement;
  readonly currency: CurrencyCode;
  readonly lines: readonly InvoiceLine[];
  readonly payments: readonly Payment[];
  /**
   * VAT, in basis points. 500 is the UAE's five percent.
   *
   * On the invoice rather than looked up, because the rate that applied when
   * it was issued is the rate that stays on it. Zero for a firm that is not
   * registered, which is why it is a number and not a flag.
   */
  readonly vatBasisPoints: number;
  readonly issuedOn: Date;
  readonly dueOn: Date;
  /** Set by the sweep. Null while it is not late. */
  readonly overdueSince: Date | null;
  readonly issuedBy: string;
  readonly notesEn: string | null;
  readonly notesAr: string | null;
}

export class Invoice extends AggregateRoot {
  private constructor(private state: InvoiceSnapshot) {
    super(state.id);
  }

  static rehydrate(state: InvoiceSnapshot): Invoice {
    return new Invoice(state);
  }

  static raise(params: {
    id: string;
    clientId: string;
    statementId: string;
    number: string;
    currency: CurrencyCode;
    lines: readonly InvoiceLine[];
    vatBasisPoints: number;
    issuedOn: Date;
    dueOn: Date;
    issuedBy: string;
    notesEn?: string | null;
    notesAr?: string | null;
  }): Result<Invoice, Conflict> {
    if (params.number.trim().length === 0) {
      return err(new Conflict('An invoice needs a number the client can file it under'));
    }
    if (params.lines.length === 0) {
      return err(new Conflict('An invoice with no lines is not a bill'));
    }
    if (params.dueOn.getTime() < params.issuedOn.getTime()) {
      return err(new Conflict('An invoice cannot fall due before it was issued'));
    }
    if (params.vatBasisPoints < 0 || params.vatBasisPoints > 10_000) {
      return err(new Conflict('That is not a VAT rate'));
    }

    for (const line of params.lines) {
      if (line.projectId.trim().length === 0) {
        // The ERD's rule, enforced where it cannot be skipped.
        return err(new Conflict('Every invoice line has to name the project it is for'));
      }
      if (line.amount.currency !== params.currency) {
        return err(new Conflict('Every line has to be in the invoice’s own currency'));
      }
      if (line.amount.isNegative()) {
        return err(new Conflict('An invoice line cannot be for a negative amount'));
      }
    }

    const invoice = new Invoice({
      id: params.id,
      clientId: params.clientId,
      statementId: params.statementId,
      number: params.number.trim(),
      settlement: 'issued',
      currency: params.currency,
      lines: params.lines,
      payments: [],
      vatBasisPoints: params.vatBasisPoints,
      issuedOn: params.issuedOn,
      dueOn: params.dueOn,
      overdueSince: null,
      issuedBy: params.issuedBy,
      notesEn: params.notesEn?.trim() || null,
      notesAr: params.notesAr?.trim() || null,
    });

    invoice.record(
      domainEvent('billing.invoice.raised', invoice.id, params.issuedOn, {
        invoiceId: invoice.id,
        clientId: params.clientId,
        statementId: params.statementId,
        number: invoice.state.number,
        totalMinor: invoice.total().minorUnits,
        currency: params.currency,
      }),
    );
    return ok(invoice);
  }

  get clientId(): string {
    return this.state.clientId;
  }

  /** Before VAT. */
  net(): Money {
    return Money.sum(
      this.state.lines.map((line) => line.amount),
      this.state.currency,
    );
  }

  vat(): Money {
    return this.net().percentageInBasisPoints(this.state.vatBasisPoints);
  }

  total(): Money {
    return this.net().add(this.vat());
  }

  paid(): Money {
    return Money.sum(
      this.state.payments.map((payment) => payment.amount),
      this.state.currency,
    );
  }

  /** What is still owed. Never negative: an overpayment is shown as settled. */
  balance(): Money {
    const outstanding = this.total().subtract(this.paid());
    return outstanding.isNegative() ? Money.zero(this.state.currency) : outstanding;
  }

  /**
   * One word for a screen.
   *
   * Lateness wins over part payment, because the reason anybody is looking at
   * this list is to decide who to chase.
   */
  status(): 'issued' | 'part_paid' | 'paid' | 'overdue' | 'cancelled' {
    if (this.state.settlement === 'cancelled') return 'cancelled';
    if (this.state.settlement === 'paid') return 'paid';
    if (this.state.overdueSince) return 'overdue';
    return this.state.settlement;
  }

  get isOverdue(): boolean {
    return this.state.overdueSince !== null;
  }

  /**
   * Records money received (FR-33).
   *
   * Partial payments are ordinary here rather than exceptional: a client
   * paying half now and half after their own receivable lands is the common
   * case, and a system that only understands paid-or-not forces somebody to
   * keep the difference in their head.
   */
  recordPayment(payment: Payment): Result<void, Conflict> {
    if (this.state.settlement === 'cancelled') {
      return err(new Conflict('That invoice was cancelled; nothing is owed on it'));
    }
    if (payment.amount.currency !== this.state.currency) {
      return err(new Conflict('A payment has to be in the invoice’s own currency'));
    }
    if (!payment.amount.isPositive()) {
      return err(new Conflict('A payment has to be for something'));
    }
    if (payment.receivedOn.getTime() < this.state.issuedOn.getTime()) {
      // Money received before the invoice existed is a payment against
      // something else, and recording it here hides whatever that was.
      return err(new Conflict('That payment predates the invoice'));
    }
    if (this.state.payments.some((existing) => existing.id === payment.id)) {
      return err(new Conflict('That payment has already been recorded'));
    }

    const payments = [...this.state.payments, payment];
    const paid = Money.sum(
      payments.map((item) => item.amount),
      this.state.currency,
    );
    const settled = paid.compare(this.total()) >= 0;

    this.state = {
      ...this.state,
      payments,
      settlement: settled ? 'paid' : 'part_paid',
      // Settling clears the lateness. It was late; it is not any more, and the
      // chase list should stop showing it the moment the money arrives.
      overdueSince: settled ? null : this.state.overdueSince,
    };

    this.record(
      domainEvent('billing.payment.received', this.id, payment.receivedOn, {
        invoiceId: this.id,
        clientId: this.state.clientId,
        paymentId: payment.id,
        amountMinor: payment.amount.minorUnits,
        balanceMinor: this.balance().minorUnits,
        settled,
      }),
    );
    return ok(undefined);
  }

  /**
   * Marks it late (FR-33).
   *
   * A stored fact rather than a computed one, so "who is overdue" is a query
   * and the day it became late is recorded — which is what the follow-up
   * ladder counts from. Idempotent, because the sweep runs every morning and
   * must not reset that day each time.
   */
  markOverdue(asOf: Date): Result<void, Conflict> {
    if (this.state.settlement === 'paid' || this.state.settlement === 'cancelled') {
      return err(new Conflict('That invoice is settled'));
    }
    if (asOf.getTime() <= this.state.dueOn.getTime()) {
      return err(new Conflict('That invoice is not late yet'));
    }
    if (this.state.overdueSince) return ok(undefined);

    this.state = { ...this.state, overdueSince: asOf };
    this.record(
      domainEvent('billing.invoice.overdue', this.id, asOf, {
        invoiceId: this.id,
        clientId: this.state.clientId,
        number: this.state.number,
        balanceMinor: this.balance().minorUnits,
        dueOn: this.state.dueOn.toISOString(),
      }),
    );
    return ok(undefined);
  }

  /**
   * Cancels it.
   *
   * Only while nothing has been paid. Once money has arrived against an
   * invoice, cancelling it would leave that payment attached to a document
   * that says nothing was owed — credit it instead, which leaves both the bill
   * and the correction on the record.
   */
  cancel(reason: string, now: Date): Result<void, Conflict> {
    if (this.state.settlement === 'cancelled') return ok(undefined);
    if (this.state.payments.length > 0) {
      return err(new Conflict('Money has been received against this invoice; credit it instead'));
    }
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      return err(new Conflict('Say why this invoice is being cancelled'));
    }

    this.state = { ...this.state, settlement: 'cancelled', overdueSince: null };
    this.record(
      domainEvent('billing.invoice.cancelled', this.id, now, {
        invoiceId: this.id,
        clientId: this.state.clientId,
        statementId: this.state.statementId,
        reason: trimmed,
      }),
    );
    return ok(undefined);
  }

  snapshot(): InvoiceSnapshot {
    return this.state;
  }
}
