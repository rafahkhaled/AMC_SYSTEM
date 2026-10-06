import {
  type Actor,
  type Clock,
  Conflict,
  type IdGenerator,
  Money,
  type Result,
  err,
  ok,
} from '@amc/kernel';
import type { Payment } from '../domain/index.js';
import type { InvoiceRepository } from './ports.js';

export interface RecordPaymentCommand {
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly receivedOn: Date;
  readonly method: string;
  readonly reference?: string | null;
  readonly chequeNumber?: string | undefined;
  readonly chequeDate?: Date | undefined;
  readonly bankName?: string | undefined;
  /** What the firm agreed to drop, with the reason that justifies it. */
  readonly discountMinor?: number | undefined;
  readonly discountReason?: string | undefined;
}

/**
 * Money arriving, and invoices falling late (FR-33).
 *
 * Both live here because they are the same question from two ends: what is
 * still owed. Keeping them together means the rule that settling clears
 * lateness is written once.
 */
export class SettleInvoice {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async record(
    actor: Actor,
    command: RecordPaymentCommand,
  ): Promise<Result<{ paymentId: string; balanceMinor: number }, Conflict>> {
    const invoice = await this.invoices.findById(command.invoiceId);
    if (!invoice) return err(new Conflict('There is no such invoice'));

    const currency = invoice.snapshot().currency;
    const payment: Payment = {
      id: this.ids.next(),
      amount: Money.ofMinor(command.amountMinor, currency),
      receivedOn: command.receivedOn,
      method: command.method,
      reference: command.reference?.trim() || null,
      chequeNumber: command.chequeNumber?.trim() || null,
      chequeDate: command.chequeDate ?? null,
      bankName: command.bankName?.trim() || null,
      discount: Money.ofMinor(command.discountMinor ?? 0, currency),
      discountReason: command.discountReason?.trim() || null,
      recordedBy: actor.userId,
    };

    const recorded = invoice.recordPayment(payment);
    if (!recorded.ok) return err(recorded.error);

    await this.invoices.save(invoice);
    return ok({ paymentId: payment.id, balanceMinor: invoice.balance().minorUnits });
  }

  /**
   * The morning sweep (P2-06).
   *
   * Idempotent by the aggregate's own rule: an invoice already marked keeps
   * the day it became late, so running this twice in a morning does not reset
   * the clock the follow-up ladder counts from.
   *
   * One invoice failing does not stop the rest. A sweep that abandons its
   * batch on the first problem leaves the remainder unmarked and nobody
   * notices until a client is chased a fortnight late.
   */
  async sweepOverdue(limit = 200): Promise<{ marked: number; skipped: number }> {
    const asOf = this.clock.now();
    const late = await this.invoices.lateAsOf(asOf, limit);

    let marked = 0;
    let skipped = 0;
    for (const invoice of late) {
      if (invoice.isOverdue) {
        skipped += 1;
        continue;
      }
      const result = invoice.markOverdue(asOf);
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      await this.invoices.save(invoice);
      marked += 1;
    }

    return { marked, skipped };
  }
}
