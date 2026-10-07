import {
  type Clock,
  Conflict,
  type CurrencyCode,
  type IdGenerator,
  Money,
  type Result,
  err,
  ok,
} from '@amc/kernel';
import { Quotation, type QuotationLine, type SentVia } from '../domain/index.js';
import type {
  BillingSettings,
  DocumentDelivery,
  InvoiceNumbering,
  LinkTokens,
  QuotationRepository,
  RateReader,
} from './ports.js';

export interface DraftQuotationCommand {
  readonly clientId: string;
  readonly reference?: string | undefined;
  readonly validUntil?: Date | null;
  readonly notesEn?: string | null;
  readonly notesAr?: string | null;
}

export interface AddLineCommand {
  readonly serviceCode?: string | undefined;
  readonly descriptionEn?: string | undefined;
  readonly descriptionAr?: string | undefined;
  readonly hours?: number | undefined;
  readonly perHourMinor?: number | undefined;
  readonly amountMinor?: number | undefined;
  readonly discountMinor?: number | undefined;
  /**
   * Whether VAT applies, not at what rate.
   *
   * The screen offers "5%" or "out of scope" and the rate behind the first
   * comes from the firm's own configuration here, so that a quotation and the
   * invoice that eventually follows it cannot disagree about what five
   * percent is.
   */
  readonly vat: 'standard' | 'out_of_scope';
}

/**
 * Writing and answering quotations (FR-30).
 *
 * The aggregate holds the rules about what may change when; this is the part
 * that has to talk to the outside world — the client's currency, the clock,
 * and a reference nobody else is already using.
 */
export class ManageQuotations {
  constructor(
    private readonly quotations: QuotationRepository,
    private readonly rates: RateReader,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /**
     * The firm's own estimate sequence, continuing from what it issued by
     * hand. Their template prints "Estimate # 192"; the next one out of this
     * system has to be 193 or the client sees a gap and asks about it.
     */
    private readonly numbering: InvoiceNumbering,
    private readonly delivery: DocumentDelivery,
    private readonly links: LinkTokens,
    /** The firm's VAT rate, which a standard-rated line is quoted at. */
    private readonly settings: BillingSettings,
    /** How long a client has to answer before the link stops working. */
    private readonly linkDays: number = 60,
  ) {}

  async draft(
    createdBy: string,
    command: DraftQuotationCommand,
  ): Promise<Result<{ quotationId: string }, Conflict>> {
    /*
     * Numbered from the firm's own sequence unless a reference is given.
     *
     * One is accepted because the practice has quotations up to 192 issued
     * before this system existed, and recording one of those afterwards has
     * to be possible. Everything drafted here takes the next number instead,
     * so nobody has to remember what it was.
     */
    const reference = command.reference?.trim() || (await this.numbering.next());

    /*
     * Checked here rather than caught from the database.
     *
     * A unique index does stop two quotations answering to one reference, but
     * it surfaces as a constraint violation halfway through a save, and what
     * somebody typing '192' for the second time needs is to be told that
     * number is taken.
     */
    const existing = await this.quotations.findByReference(reference);
    if (existing) {
      return err(new Conflict('A quotation with that reference already exists'));
    }

    const currency = await this.rates.currencyFor(command.clientId);
    const quotation = Quotation.draft({
      id: this.ids.next(),
      clientId: command.clientId,
      reference,
      currency,
      createdBy,
      validUntil: command.validUntil ?? null,
      notesEn: command.notesEn ?? null,
      notesAr: command.notesAr ?? null,
      now: this.clock.now(),
    });
    if (!quotation.ok) return err(quotation.error);

    await this.quotations.save(quotation.value);
    return ok({ quotationId: quotation.value.id });
  }

  async addLine(quotationId: string, command: AddLineCommand): Promise<Result<void, Conflict>> {
    const quotation = await this.quotations.findById(quotationId);
    if (!quotation) return err(new Conflict('There is no such quotation'));

    const currency = quotation.snapshot().currency;
    const pricing = priceIt(command, currency);
    if (!pricing.ok) return err(pricing.error);

    const line: QuotationLine = {
      id: this.ids.next(),
      serviceCode: command.serviceCode ?? null,
      descriptionEn: command.descriptionEn?.trim() ?? '',
      descriptionAr: command.descriptionAr?.trim() ?? '',
      pricing: pricing.value,
      discount: Money.ofMinor(command.discountMinor ?? 0, currency),
      /*
       * Stamped now, from configuration. The rate the client was quoted at is
       * the rate they agreed to, whatever the firm's rate becomes later —
       * the same reason the invoice keeps its own.
       */
      vatBasisPoints: command.vat === 'standard' ? this.settings.vatBasisPoints : null,
    };

    const added = quotation.addLine(line);
    if (!added.ok) return err(added.error);

    await this.quotations.save(quotation);
    return ok(undefined);
  }

  async removeLine(quotationId: string, lineId: string): Promise<Result<void, Conflict>> {
    return this.change(quotationId, (quotation) => quotation.removeLine(lineId));
  }

  /**
   * With the client (FR-30).
   *
   * `deliver` decides whether the system sends it or merely records that
   * somebody did. Both are real: half of these are printed and handed over,
   * and the quotation keeps which it was, because "sent" used to mean only
   * that a button had been pressed.
   *
   * Delivery happens before the state changes. If the mail fails, the
   * quotation is still a draft and can be tried again — the other order
   * leaves a quotation marked sent that nobody received.
   */
  async send(
    quotationId: string,
    options: { deliver: boolean } = { deliver: false },
  ): Promise<Result<{ via: SentVia }, Conflict>> {
    const quotation = await this.quotations.findById(quotationId);
    if (!quotation) return err(new Conflict('There is no such quotation'));

    /*
     * Asked before anything leaves the building.
     *
     * The aggregate holds the rules and would refuse a quotation with no
     * lines anyway — but it would refuse it after the client had already
     * received the email, and nothing un-sends that.
     */
    const allowed = quotation.canSend(this.clock.now());
    if (!allowed.ok) return err(allowed.error);

    let via: SentVia = 'by_hand';
    if (options.deliver) {
      const state = quotation.snapshot();

      /*
       * A fresh link every time it is emailed.
       *
       * Issuing revokes the previous one, which is what somebody wants when
       * the first went to the wrong address. It expires — an offer that can
       * still be accepted two years later is a price the firm never agreed
       * to hold.
       */
      const { token, tokenHash } = this.links.issue();
      const expiresAt = new Date(this.clock.now().getTime() + this.linkDays * 86_400_000);
      const issued = quotation.issueLink(tokenHash, expiresAt, this.clock.now());
      if (!issued.ok) return err(issued.error);

      const channel = await this.delivery.quotation({
        quotationId,
        clientId: state.clientId,
        reference: state.reference,
        total: quotation.total(),
        validUntil: state.validUntil,
        linkToken: token,
      });
      if (channel === null) {
        return err(
          new Conflict('That client has no email address on file; send it by hand instead'),
        );
      }
      via = channel;
    }

    /*
     * Saved here rather than through `change`, which reloads the aggregate
     * and would drop the link this one just issued.
     */
    const sent = quotation.send(this.clock.now(), via);
    if (!sent.ok) return err(sent.error);
    await this.quotations.save(quotation);
    return ok({ via });
  }

  /**
   * Emailing it again, with a new link (FR-30).
   *
   * Separate from `send` because the state does not change: it is already
   * with the client. This is for the quotation that went to the wrong
   * address, or the one somebody has lost — and without it the first link
   * would be the only one there could ever be, since a sent quotation cannot
   * be sent again.
   *
   * The previous link stops working, which is the point rather than a side
   * effect: a quotation sent to the wrong person should not stay answerable
   * by them.
   */
  async sendAgain(quotationId: string): Promise<Result<void, Conflict>> {
    const quotation = await this.quotations.findById(quotationId);
    if (!quotation) return err(new Conflict('There is no such quotation'));

    const state = quotation.snapshot();
    if (state.state !== 'sent') {
      return err(new Conflict('Only a quotation already with the client can be sent again'));
    }

    const now = this.clock.now();
    const { token, tokenHash } = this.links.issue();
    const issued = quotation.issueLink(
      tokenHash,
      new Date(now.getTime() + this.linkDays * 86_400_000),
      now,
    );
    if (!issued.ok) return err(issued.error);

    const channel = await this.delivery.quotation({
      quotationId,
      clientId: state.clientId,
      reference: state.reference,
      total: quotation.total(),
      validUntil: state.validUntil,
      linkToken: token,
    });
    if (channel === null) {
      return err(new Conflict('That client has no email address on file'));
    }

    await this.quotations.save(quotation);
    return ok(undefined);
  }

  async accept(quotationId: string): Promise<Result<void, Conflict>> {
    return this.change(quotationId, (quotation) => quotation.accept(this.clock.now()));
  }

  async decline(quotationId: string): Promise<Result<void, Conflict>> {
    return this.change(quotationId, (quotation) => quotation.decline(this.clock.now()));
  }

  /**
   * The expiry sweep.
   *
   * A stored state rather than a computed one, so "what did the client never
   * answer" is a query rather than a walk over every quotation ever sent. One
   * failing does not stop the rest: a sweep that abandons its batch leaves the
   * remainder looking live, and somebody chases a price that lapsed.
   */
  async sweepExpired(limit = 200): Promise<{ expired: number }> {
    const asOf = this.clock.now();
    const lapsed = await this.quotations.lapsed(asOf, limit);

    let expired = 0;
    for (const quotation of lapsed) {
      const result = quotation.expire(asOf);
      if (!result.ok) continue;
      await this.quotations.save(quotation);
      expired += 1;
    }
    return { expired };
  }

  private async change(
    quotationId: string,
    act: (quotation: Quotation) => Result<void, Conflict>,
  ): Promise<Result<void, Conflict>> {
    const quotation = await this.quotations.findById(quotationId);
    if (!quotation) return err(new Conflict('There is no such quotation'));

    const done = act(quotation);
    if (!done.ok) return err(done.error);

    await this.quotations.save(quotation);
    return ok(undefined);
  }
}

/** Hours and a rate, or a fixed amount. Never both, and never neither. */
function priceIt(
  command: AddLineCommand,
  currency: CurrencyCode,
): Result<QuotationLine['pricing'], Conflict> {
  const byHours = command.hours !== undefined && command.perHourMinor !== undefined;
  const byAmount = command.amountMinor !== undefined;

  if (byHours === byAmount) {
    return err(new Conflict('Price it by hours and a rate, or as a fixed amount, but not both'));
  }

  if (byHours) {
    return ok({
      kind: 'hours',
      hours: command.hours as number,
      perHour: Money.ofMinor(command.perHourMinor as number, currency),
    });
  }
  return ok({ kind: 'fixed', amount: Money.ofMinor(command.amountMinor as number, currency) });
}
