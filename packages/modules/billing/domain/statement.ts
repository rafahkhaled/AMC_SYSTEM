import {
  AggregateRoot,
  Conflict,
  type CurrencyCode,
  Duration,
  Money,
  Rate,
  type Result,
  domainEvent,
  err,
  ok,
} from '@amc/kernel';

/**
 * A statement of work done (FR-31, FR-32).
 *
 * Approved, unbilled, billable hours priced at the rate that applied *on the
 * day the work was done*, not today's rate. That distinction is the whole
 * reason rates are effective-dated: a firm that raises its rate in March and
 * then bills February at the new one has overcharged, and the client's own
 * record of the engagement will say so.
 *
 * It is a review document before it is a bill. Every line can be excluded or
 * adjusted, and neither is possible without a reason — because the question
 * asked six months later is never "what did we charge" but "why is this line
 * not what the timesheet says".
 *
 * Converting it to an invoice is a separate task, and the thing that makes an
 * invoice defensible is that every line still points at a project.
 */

export type StatementState = 'draft' | 'approved' | 'invoiced' | 'cancelled';

/**
 * How a statement line is charged.
 *
 * Distinct from a quotation's `LinePricing`, which describes how an offer was
 * *made* — an estimate of hours, or a fixed price. This describes how work
 * already done is being *charged*, and the two diverge the moment an estimate
 * turns out wrong.
 *
 * `hourly` is recorded time at the rate that applied the day it was worked.
 * `fixed` is an agreed fee — for one project, or for a month under a retainer
 * — and carries no rate at all. Deriving a rate by dividing the fee by the
 * hours would produce a number that moves every time somebody records more
 * time, on a document the client reads.
 */
export type StatementPricing =
  | { readonly kind: 'hourly'; readonly perHour: Money }
  | { readonly kind: 'fixed'; readonly fee: Money };

export interface StatementLine {
  readonly id: string;
  /** Required, always. Nothing bills without a project (ERD rule 4). */
  readonly projectId: string;
  readonly service: string;
  /** The day the work was done, which decides the rate. */
  readonly performedOn: Date;
  readonly userId: string | null;
  /**
   * Always recorded, whatever the pricing.
   *
   * Under a fee the hours stop deciding what the client pays and start
   * answering whether the fee was worth the work. A firm that bills fixed
   * fees and stops recording time cannot tell a good client from a bad one
   * until it is losing money on both.
   */
  readonly worked: Duration;
  readonly pricing: StatementPricing;
  /** The time entries behind this line, frozen once it is invoiced. */
  readonly entryIds: readonly string[];
  readonly excluded: boolean;
  readonly excludedReason: string | null;
  /** Set when somebody billed a different figure from the one the clock gave. */
  readonly adjustedTo: Money | null;
  readonly adjustedReason: string | null;
}

export interface StatementSnapshot {
  readonly id: string;
  readonly clientId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly state: StatementState;
  readonly currency: CurrencyCode;
  readonly lines: readonly StatementLine[];
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
}

/**
 * What a line is worth.
 *
 * Excluded is zero. An adjustment replaces the figure outright rather than
 * discounting it, because "we agreed 500 for this" is what gets written down
 * in practice, and a percentage that happens to land on 500 is a worse record
 * of the same decision.
 */
export function lineAmount(line: StatementLine): Money {
  if (line.excluded) return Money.zero(lineCurrency(line));
  if (line.adjustedTo) return line.adjustedTo;
  return asWorked(line);
}

/** What the line comes to before anybody excluded or adjusted it. */
export function asWorked(line: StatementLine): Money {
  return line.pricing.kind === 'fixed'
    ? line.pricing.fee
    : Rate.perHour(line.pricing.perHour).amountFor(line.worked);
}

function lineCurrency(line: StatementLine): CurrencyCode {
  return line.pricing.kind === 'fixed' ? line.pricing.fee.currency : line.pricing.perHour.currency;
}

export class Statement extends AggregateRoot {
  private constructor(private state: StatementSnapshot) {
    super(state.id);
  }

  static rehydrate(state: StatementSnapshot): Statement {
    return new Statement(state);
  }

  static draft(params: {
    id: string;
    clientId: string;
    periodStart: Date;
    periodEnd: Date;
    currency: CurrencyCode;
    lines: readonly StatementLine[];
    createdBy: string;
    now: Date;
  }): Result<Statement, Conflict> {
    if (params.periodEnd.getTime() < params.periodStart.getTime()) {
      return err(new Conflict('A statement period has to end after it starts'));
    }

    for (const line of params.lines) {
      if (lineCurrency(line) !== params.currency) {
        return err(new Conflict('Every line has to be in the statement’s own currency'));
      }
    }

    return ok(
      new Statement({
        id: params.id,
        clientId: params.clientId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        state: 'draft',
        currency: params.currency,
        lines: params.lines,
        createdBy: params.createdBy,
        createdAt: params.now,
        approvedAt: null,
        approvedBy: null,
      }),
    );
  }

  get clientId(): string {
    return this.state.clientId;
  }

  get currentState(): StatementState {
    return this.state.state;
  }

  /**
   * The currency this statement is in.
   *
   * Exposed so a caller adjusting a line can build the amount in the right
   * one without re-deriving it from a string that crossed the wire. The
   * aggregate already knows; asking it is both shorter and impossible to get
   * wrong.
   */
  get currency(): CurrencyCode {
    return this.state.currency;
  }

  /** What the client is being asked to pay. */
  total(): Money {
    return Money.sum(
      this.state.lines.map((line) => lineAmount(line)),
      this.state.currency,
    );
  }

  /** What the lines came to, before anybody excluded or adjusted anything. */
  totalAsWorked(): Money {
    return Money.sum(
      this.state.lines.map((line) => asWorked(line)),
      this.state.currency,
    );
  }

  /** The hours behind it, including the ones taken off. */
  totalWorked(): Duration {
    return this.state.lines.reduce((running, line) => running.plus(line.worked), Duration.zero());
  }

  /**
   * Takes a line off the statement (FR-32).
   *
   * The reason is mandatory and is not a formality. "Why is this line not what
   * the timesheet says" is the only question anybody asks of a statement
   * afterwards, and an answer recorded at the time is worth more than any
   * amount of reconstruction later.
   *
   * The line stays on the statement rather than being deleted, so the
   * difference between what was worked and what was billed is visible on the
   * document itself.
   */
  exclude(lineId: string, reason: string, now: Date): Result<void, Conflict> {
    return this.reviseLine(lineId, reason, now, (line, trimmed) => ({
      ...line,
      excluded: true,
      excludedReason: trimmed,
    }));
  }

  restore(lineId: string, now: Date): Result<void, Conflict> {
    const editable = this.mustBeDraft();
    if (!editable.ok) return editable;

    const line = this.state.lines.find((candidate) => candidate.id === lineId);
    if (!line) return err(new Conflict('There is no such line on this statement'));
    if (!line.excluded) return err(new Conflict('That line is not excluded'));

    this.replace({ ...line, excluded: false, excludedReason: null });
    this.record(
      domainEvent('billing.statement.line_restored', this.id, now, {
        statementId: this.id,
        lineId,
      }),
    );
    return ok(undefined);
  }

  /**
   * Bills a different figure from the one the clock gave (FR-32).
   *
   * Never negative, and never silently: a write-down a client can see is a
   * goodwill gesture, and the same write-down invisible in the system is a
   * gap between the timesheet and the ledger that somebody has to explain at
   * year end.
   */
  adjust(lineId: string, to: Money, reason: string, now: Date): Result<void, Conflict> {
    if (to.currency !== this.state.currency) {
      return err(new Conflict('An adjustment has to be in the statement’s own currency'));
    }
    if (to.isNegative()) {
      return err(new Conflict('A line cannot be adjusted to a negative amount'));
    }

    return this.reviseLine(lineId, reason, now, (line, trimmed) => ({
      ...line,
      adjustedTo: to,
      adjustedReason: trimmed,
    }));
  }

  /**
   * Approves it for invoicing.
   *
   * A statement of nothing cannot be approved: every line excluded means there
   * is nothing to bill, and an invoice for zero is a document that confuses
   * the client and the ledger equally.
   */
  approve(userId: string, now: Date): Result<void, Conflict> {
    const editable = this.mustBeDraft();
    if (!editable.ok) return editable;

    if (this.state.lines.length === 0) {
      return err(new Conflict('There is nothing on this statement to approve'));
    }
    if (this.total().isZero()) {
      return err(new Conflict('Every line has been excluded, so there is nothing to bill'));
    }

    this.state = { ...this.state, state: 'approved', approvedAt: now, approvedBy: userId };
    this.record(
      domainEvent('billing.statement.approved', this.id, now, {
        statementId: this.id,
        clientId: this.state.clientId,
        totalMinor: this.total().minorUnits,
        currency: this.state.currency,
        lines: this.state.lines.length,
      }),
    );
    return ok(undefined);
  }

  /** Sends it back for more work. */
  reopen(now: Date): Result<void, Conflict> {
    if (this.state.state !== 'approved') {
      return err(new Conflict('Only an approved statement can be reopened'));
    }
    this.state = { ...this.state, state: 'draft', approvedAt: null, approvedBy: null };
    this.record(domainEvent('billing.statement.reopened', this.id, now, { statementId: this.id }));
    return ok(undefined);
  }

  /** Marked once an invoice has been raised from it. */
  markInvoiced(now: Date): Result<void, Conflict> {
    if (this.state.state !== 'approved') {
      return err(new Conflict('Only an approved statement can be invoiced'));
    }
    this.state = { ...this.state, state: 'invoiced' };
    this.record(
      domainEvent('billing.statement.invoiced', this.id, now, {
        statementId: this.id,
        clientId: this.state.clientId,
      }),
    );
    return ok(undefined);
  }

  /**
   * Cancels it, and says why.
   *
   * The reason is not optional because cancelling releases billed hours back
   * to the unbilled pool, and that is the one change permitted to time a
   * client has already been shown. The event carries the words into the audit
   * log, which is where somebody looks when a month is billed twice.
   */
  cancel(reason: string, now: Date): Result<void, Conflict> {
    if (this.state.state === 'invoiced') {
      // The hours behind it are frozen and an invoice exists. Credit the
      // invoice instead; cancelling here would orphan it.
      return err(new Conflict('This statement has been invoiced; credit the invoice instead'));
    }

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      return err(new Conflict('Say why this statement is being cancelled'));
    }

    this.state = { ...this.state, state: 'cancelled' };
    this.record(
      domainEvent('billing.statement.cancelled', this.id, now, {
        statementId: this.id,
        clientId: this.state.clientId,
        reason: trimmed,
        releasedEntries: this.entryIds().length,
      }),
    );
    return ok(undefined);
  }

  /** Every time entry on the statement, which is what gets frozen. */
  entryIds(): readonly string[] {
    return this.state.lines.flatMap((line) => line.entryIds);
  }

  private reviseLine(
    lineId: string,
    reason: string,
    now: Date,
    change: (line: StatementLine, reason: string) => StatementLine,
  ): Result<void, Conflict> {
    const editable = this.mustBeDraft();
    if (!editable.ok) return editable;

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      return err(new Conflict('Say why, in a few words that will still make sense later'));
    }

    const line = this.state.lines.find((candidate) => candidate.id === lineId);
    if (!line) return err(new Conflict('There is no such line on this statement'));

    const revised = change(line, trimmed);
    this.replace(revised);
    this.record(
      domainEvent('billing.statement.line_revised', this.id, now, {
        statementId: this.id,
        lineId,
        excluded: revised.excluded,
        adjustedToMinor: revised.adjustedTo?.minorUnits ?? null,
        reason: trimmed,
      }),
    );
    return ok(undefined);
  }

  private replace(line: StatementLine): void {
    this.state = {
      ...this.state,
      lines: this.state.lines.map((candidate) => (candidate.id === line.id ? line : candidate)),
    };
  }

  private mustBeDraft(): Result<void, Conflict> {
    if (this.state.state !== 'draft') {
      return err(new Conflict('Only a draft statement can be changed'));
    }
    return ok(undefined);
  }

  snapshot(): StatementSnapshot {
    return this.state;
  }
}
