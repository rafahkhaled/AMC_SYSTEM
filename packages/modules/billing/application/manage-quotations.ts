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
import { Quotation, type QuotationLine } from '../domain/index.js';
import type { QuotationRepository, RateReader } from './ports.js';

export interface DraftQuotationCommand {
  readonly clientId: string;
  readonly reference: string;
  readonly validUntil?: Date | null;
  readonly notesEn?: string | null;
  readonly notesAr?: string | null;
}

export interface AddLineCommand {
  readonly descriptionEn?: string | undefined;
  readonly descriptionAr?: string | undefined;
  readonly hours?: number | undefined;
  readonly perHourMinor?: number | undefined;
  readonly amountMinor?: number | undefined;
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
  ) {}

  async draft(
    createdBy: string,
    command: DraftQuotationCommand,
  ): Promise<Result<{ quotationId: string }, Conflict>> {
    /*
     * The reference is checked here rather than caught from the database.
     *
     * A unique index does stop two quotations answering to one reference, but
     * it surfaces as a constraint violation halfway through a save, and what
     * somebody typing 'Q-2026-014' for the second time needs is to be told
     * that number is taken.
     */
    const existing = await this.quotations.findByReference(command.reference.trim());
    if (existing) {
      return err(new Conflict('A quotation with that reference already exists'));
    }

    const currency = await this.rates.currencyFor(command.clientId);
    const quotation = Quotation.draft({
      id: this.ids.next(),
      clientId: command.clientId,
      reference: command.reference,
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
      descriptionEn: command.descriptionEn?.trim() ?? '',
      descriptionAr: command.descriptionAr?.trim() ?? '',
      pricing: pricing.value,
    };

    const added = quotation.addLine(line);
    if (!added.ok) return err(added.error);

    await this.quotations.save(quotation);
    return ok(undefined);
  }

  async removeLine(quotationId: string, lineId: string): Promise<Result<void, Conflict>> {
    return this.change(quotationId, (quotation) => quotation.removeLine(lineId));
  }

  async send(quotationId: string): Promise<Result<void, Conflict>> {
    return this.change(quotationId, (quotation) => quotation.send(this.clock.now()));
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
