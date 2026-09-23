import {
  AggregateRoot,
  Conflict,
  type CurrencyCode,
  Money,
  type Result,
  domainEvent,
  err,
  ok,
} from '@amc/kernel';

/**
 * What a quotation is doing here.
 *
 * It is the firm's offer, before any work exists: a client asks what a VAT
 * registration will cost, and this is the answer they can hold the practice to.
 * It is deliberately *not* an invoice and does not become one — work happens in
 * between, hours are recorded against it, and what is eventually billed is the
 * statement of that work. A quotation that turned into an invoice would let a
 * firm bill for work nobody did, which is the exact thing the ERD's "no invoice
 * without a project" rule exists to prevent.
 *
 * So this aggregate has one job: say what was offered, to whom, for how much,
 * and whether they said yes.
 */

/** How a quotation reached the client. */
export type SentVia = 'email' | 'by_hand';

/**
 * Who answered it.
 *
 * "The client accepted through the link" and "an accountant ticked accepted"
 * are different evidence, and the difference is the whole reason for sending
 * a link at all.
 */
export type DecidedBy = 'client' | 'staff';

export type QuotationState = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

/**
 * How a line is priced.
 *
 * `hours` carries an estimate and an hourly rate, and multiplies them; `fixed`
 * carries an amount and is what the firm will charge whatever the work takes.
 * Both end up as an amount, but which one was offered matters afterwards: a
 * fixed-fee quotation accepted at 5,000 is still 5,000 when the work runs long,
 * and an hourly estimate is not.
 */
export type LinePricing =
  | { readonly kind: 'hours'; readonly hours: number; readonly perHour: Money }
  | { readonly kind: 'fixed'; readonly amount: Money };

export interface QuotationLine {
  readonly id: string;
  /** Both languages: the client reads one of them and it is not always English. */
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly pricing: LinePricing;
}

export interface QuotationSnapshot {
  readonly id: string;
  readonly clientId: string;
  /** The reference the client quotes back at you. */
  readonly reference: string;
  readonly state: QuotationState;
  readonly currency: CurrencyCode;
  readonly lines: readonly QuotationLine[];
  readonly validUntil: Date | null;
  readonly sentAt: Date | null;
  /**
   * How it reached the client, or null while it is a draft.
   *
   * `by_hand` is a real answer — printing the sheet and handing it over is
   * how half of these go out — but it is a different claim from "we emailed
   * it", and the difference is what somebody needs a fortnight later when
   * they ask whether the client ever actually saw it.
   */
  readonly sentVia: SentVia | null;
  /** SHA-256 of the client's link token. The token itself is never stored. */
  readonly linkTokenHash: string | null;
  readonly linkExpiresAt: Date | null;
  /** When the client first opened it, or null if they never have. */
  readonly linkOpenedAt: Date | null;
  readonly decidedBy: DecidedBy | null;
  readonly decidedAt: Date | null;
  readonly notesEn: string | null;
  readonly notesAr: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** What a line comes to. One place, so the total and the line always agree. */
export function lineTotal(pricing: LinePricing): Money {
  if (pricing.kind === 'fixed') return pricing.amount;
  /*
   * Hours are given to two decimal places — "3.5 hours" — and money is whole
   * fils, so this is a ratio rather than a multiplication by a float. 3.5 hours
   * at 12,345 fils is 43,207.5 fils, and which way that rounds has to be one
   * decision in one place rather than whatever the float did.
   */
  return pricing.perHour.scaleByRatio(Math.round(pricing.hours * 100), 100);
}

export class Quotation extends AggregateRoot {
  private constructor(private state: QuotationSnapshot) {
    super(state.id);
  }

  static rehydrate(state: QuotationSnapshot): Quotation {
    return new Quotation(state);
  }

  static draft(params: {
    id: string;
    clientId: string;
    reference: string;
    currency: CurrencyCode;
    createdBy: string;
    validUntil?: Date | null;
    notesEn?: string | null;
    notesAr?: string | null;
    now: Date;
  }): Result<Quotation, Conflict> {
    const reference = params.reference.trim();
    if (reference.length === 0) {
      return err(new Conflict('A quotation needs a reference the client can quote back'));
    }

    return ok(
      new Quotation({
        id: params.id,
        clientId: params.clientId,
        reference,
        state: 'draft',
        currency: params.currency,
        lines: [],
        validUntil: params.validUntil ?? null,
        sentAt: null,
        sentVia: null,
        linkTokenHash: null,
        linkExpiresAt: null,
        linkOpenedAt: null,
        decidedBy: null,
        decidedAt: null,
        notesEn: params.notesEn?.trim() || null,
        notesAr: params.notesAr?.trim() || null,
        createdBy: params.createdBy,
        createdAt: params.now,
      }),
    );
  }

  get clientId(): string {
    return this.state.clientId;
  }

  get currentState(): QuotationState {
    return this.state.state;
  }

  /** Everything offered, added up. */
  total(): Money {
    return Money.sum(
      this.state.lines.map((line) => lineTotal(line.pricing)),
      this.state.currency,
    );
  }

  /**
   * Adds a line.
   *
   * Only while it is a draft. Once a quotation has been sent, the thing the
   * client is holding and the thing in this system have to be the same
   * document — a quotation that can be edited after sending is a quotation
   * nobody can rely on, including the firm.
   */
  addLine(line: QuotationLine): Result<void, Conflict> {
    const editable = this.mustBeDraft();
    if (!editable.ok) return editable;

    if (line.descriptionEn.trim().length === 0 && line.descriptionAr.trim().length === 0) {
      return err(new Conflict('Say what the line is for, in at least one language'));
    }

    const amount = lineTotal(line.pricing);
    if (amount.currency !== this.state.currency) {
      return err(new Conflict('Every line has to be in the quotation’s own currency'));
    }
    if (amount.isNegative()) {
      return err(new Conflict('A quotation line cannot be for a negative amount'));
    }
    if (line.pricing.kind === 'hours' && line.pricing.hours <= 0) {
      return err(new Conflict('An estimate of no hours is not an estimate'));
    }

    this.state = { ...this.state, lines: [...this.state.lines, line] };
    return ok(undefined);
  }

  removeLine(lineId: string): Result<void, Conflict> {
    const editable = this.mustBeDraft();
    if (!editable.ok) return editable;

    const remaining = this.state.lines.filter((line) => line.id !== lineId);
    if (remaining.length === this.state.lines.length) {
      return err(new Conflict('There is no such line on this quotation'));
    }
    this.state = { ...this.state, lines: remaining };
    return ok(undefined);
  }

  /**
   * Whether this could go to the client right now, changing nothing.
   *
   * Asked before anything is actually delivered. Emailing a client and then
   * discovering the quotation had no lines on it sends them an offer the firm
   * then refuses to stand behind, and no amount of tidying up afterwards
   * un-sends it. The guards live here, once, and `send` uses the same ones.
   */
  canSend(now: Date): Result<void, Conflict> {
    if (this.state.state !== 'draft') {
      return err(new Conflict('Only a draft can be sent'));
    }
    if (this.state.lines.length === 0) {
      // A document offering nothing for nothing is not an offer, and the
      // client reads it as a mistake — which it is.
      return err(new Conflict('A quotation with no lines is not an offer'));
    }
    if (this.state.validUntil && this.state.validUntil.getTime() <= now.getTime()) {
      // Sending something that has already expired wastes the client's time
      // and the firm's credibility.
      return err(new Conflict('That quotation has already expired; change the date first'));
    }
    return ok(undefined);
  }

  /**
   * With the client now (FR-30).
   *
   * From here the document is fixed. `via` is required rather than defaulted,
   * because the whole point of it is that the state can no longer be reached
   * without somebody saying how the client was told.
   */
  send(now: Date, via: SentVia): Result<void, Conflict> {
    const allowed = this.canSend(now);
    if (!allowed.ok) return allowed;

    this.state = { ...this.state, state: 'sent', sentAt: now, sentVia: via };
    this.record(
      domainEvent('billing.quotation.sent', this.id, now, {
        quotationId: this.id,
        clientId: this.state.clientId,
        reference: this.state.reference,
        totalMinor: this.total().minorUnits,
        currency: this.state.currency,
      }),
    );
    return ok(undefined);
  }

  accept(now: Date, by: DecidedBy = 'staff'): Result<void, Conflict> {
    return this.decide('accepted', 'billing.quotation.accepted', now, by);
  }

  decline(now: Date, by: DecidedBy = 'staff'): Result<void, Conflict> {
    return this.decide('declined', 'billing.quotation.declined', now, by);
  }

  /**
   * A link the client can open without an account (FR-30).
   *
   * Only the hash is kept. Issuing again replaces it, which revokes the
   * previous link — the behaviour somebody wants when a quotation went to the
   * wrong address.
   *
   * Refused once answered: a link that still accepts a decision after the
   * client has made one is a way to change their answer without anybody
   * noticing.
   */
  issueLink(tokenHash: string, expiresAt: Date, now: Date): Result<void, Conflict> {
    if (this.state.state === 'accepted' || this.state.state === 'declined') {
      return err(new Conflict('That quotation has already been answered'));
    }
    if (expiresAt.getTime() <= now.getTime()) {
      return err(new Conflict('A link has to outlast the moment it was made'));
    }

    this.state = { ...this.state, linkTokenHash: tokenHash, linkExpiresAt: expiresAt };
    this.record(
      domainEvent('billing.quotation.link_issued', this.id, now, {
        quotationId: this.id,
        clientId: this.state.clientId,
        expiresAt: expiresAt.toISOString(),
      }),
    );
    return ok(undefined);
  }

  /**
   * The client opened it.
   *
   * Recorded once, the first time. A second visit is not news, and
   * overwriting would lose the answer to the question actually being asked:
   * have they looked at this at all?
   */
  openedByClient(now: Date): void {
    if (this.state.linkOpenedAt !== null) return;
    this.state = { ...this.state, linkOpenedAt: now };
    this.record(
      domainEvent('billing.quotation.opened', this.id, now, {
        quotationId: this.id,
        clientId: this.state.clientId,
      }),
    );
  }

  /** Whether this link is still good at a given moment. */
  linkIsLiveAt(now: Date): boolean {
    if (this.state.linkTokenHash === null || this.state.linkExpiresAt === null) return false;
    return this.state.linkExpiresAt.getTime() > now.getTime();
  }

  /**
   * Marks it expired.
   *
   * A swept state rather than a computed one, so that "what did the client
   * never answer" is a query rather than a calculation over every quotation
   * ever sent. Only a sent quotation expires: a draft nobody sent has not
   * lapsed, it was abandoned, and an accepted one stays accepted.
   */
  expire(now: Date): Result<void, Conflict> {
    if (this.state.state !== 'sent') {
      return err(new Conflict('Only a quotation that was sent can expire'));
    }
    if (!this.state.validUntil || this.state.validUntil.getTime() > now.getTime()) {
      return err(new Conflict('That quotation has not expired yet'));
    }

    this.state = { ...this.state, state: 'expired' };
    this.record(
      domainEvent('billing.quotation.expired', this.id, now, {
        quotationId: this.id,
        clientId: this.state.clientId,
      }),
    );
    return ok(undefined);
  }

  private decide(
    next: 'accepted' | 'declined',
    event: string,
    now: Date,
    by: DecidedBy,
  ): Result<void, Conflict> {
    if (this.state.state !== 'sent') {
      // Including an expired one: the honest move is to re-quote rather than
      // quietly accept a price that lapsed.
      return err(new Conflict('Only a quotation that is out with the client can be answered'));
    }

    this.state = { ...this.state, state: next, decidedAt: now, decidedBy: by };
    this.record(
      domainEvent(event, this.id, now, {
        quotationId: this.id,
        clientId: this.state.clientId,
        totalMinor: this.total().minorUnits,
        currency: this.state.currency,
        decidedBy: by,
      }),
    );
    return ok(undefined);
  }

  private mustBeDraft(): Result<void, Conflict> {
    if (this.state.state !== 'draft') {
      return err(new Conflict('A quotation that has been sent cannot be changed, only replaced'));
    }
    return ok(undefined);
  }

  snapshot(): QuotationSnapshot {
    return this.state;
  }
}
