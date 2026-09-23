import type { ClientQuotationView } from '@amc/contracts';
import { type Clock, Conflict, type Result, err, ok } from '@amc/kernel';
import { type Quotation, lineTotal } from '../domain/index.js';
import type { LinkTokens, QuotationRepository } from './ports.js';

/**
 * What a client sees, and answers, without an account (FR-30).
 *
 * The one part of this system a person outside the firm can reach, so it is
 * written to give away as little as possible: a token that is looked up by
 * hash, a view with nothing on it but the offer itself, and one answer per
 * quotation.
 *
 * Every refusal is the same refusal. A wrong token, an expired link, a
 * quotation somebody already answered and one that was never sent all read as
 * "this link is not available", because a page that distinguishes them tells
 * somebody working through guesses which of them they have found.
 */
export class ClientQuotation {
  constructor(
    private readonly quotations: QuotationRepository,
    private readonly tokens: LinkTokens,
    private readonly clock: Clock,
  ) {}

  /**
   * Opening the link.
   *
   * Records that the client looked, once, which is what the firm actually
   * wants to know before ringing them a second time.
   */
  async open(token: string): Promise<Result<ClientQuotationView, Conflict>> {
    const found = await this.live(token);
    if (!found.ok) return err(found.error);

    const quotation = found.value;
    quotation.openedByClient(this.clock.now());
    await this.quotations.save(quotation);

    return ok(this.view(quotation));
  }

  async answer(
    token: string,
    decision: 'accept' | 'decline',
  ): Promise<Result<ClientQuotationView, Conflict>> {
    const found = await this.live(token);
    if (!found.ok) return err(found.error);

    const quotation = found.value;
    const now = this.clock.now();
    /*
     * `client`, not `staff`. The whole reason for the link is that the answer
     * came from the person being quoted, and a record that cannot tell the
     * two apart is no better than the phone call it replaces.
     */
    const answered =
      decision === 'accept' ? quotation.accept(now, 'client') : quotation.decline(now, 'client');
    if (!answered.ok) return err(answered.error);

    await this.quotations.save(quotation);
    return ok(this.view(quotation));
  }

  /** The quotation this token opens, if the link is still good. */
  private async live(token: string) {
    const unavailable = new Conflict('That link is not available');
    if (token.length === 0) return err(unavailable);

    const quotation = await this.quotations.findByLinkHash(this.tokens.hash(token));
    if (!quotation) return err(unavailable);
    if (!quotation.linkIsLiveAt(this.clock.now())) return err(unavailable);

    return ok(quotation);
  }

  /**
   * Only what belongs on the client's own document.
   *
   * No internal notes, no who drafted it, no client id — nothing the client
   * would not already have on the paper version. A view that leaks the shape
   * of the system is a view that invites somebody to go looking.
   */
  private view(quotation: Quotation): ClientQuotationView {
    const state = quotation.snapshot();
    return {
      reference: state.reference,
      state: state.state,
      currency: state.currency,
      lines: state.lines.map((line) => ({
        descriptionEn: line.descriptionEn,
        descriptionAr: line.descriptionAr,
        amount: { minorUnits: lineTotal(line.pricing).minorUnits, currency: state.currency },
      })),
      total: { minorUnits: quotation.total().minorUnits, currency: state.currency },
      validUntil: state.validUntil ? state.validUntil.toISOString().slice(0, 10) : null,
      notesEn: state.notesEn,
      notesAr: state.notesAr,
      /** Whether this client may still answer, so the page knows what to show. */
      answerable: state.state === 'sent',
    };
  }
}
