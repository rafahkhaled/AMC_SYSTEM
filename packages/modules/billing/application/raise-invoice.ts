import {
  type Clock,
  Conflict,
  type IdGenerator,
  type Money,
  type Result,
  err,
  ok,
} from '@amc/kernel';
import { Invoice, type InvoiceLine, type StatementLine, lineAmount } from '../domain/index.js';
import type {
  BillingSettings,
  InvoiceNumbering,
  InvoiceRepository,
  StatementRepository,
} from './ports.js';

/**
 * Turning an approved statement into a bill (FR-32, P2-05).
 *
 * One action, and deliberately not reversible by another: an invoice that can
 * be un-raised is a number that can be reused, and a client with two different
 * documents bearing one reference has a dispute nobody can settle. Cancelling
 * leaves the invoice on the record saying it was cancelled.
 *
 * Excluded lines do not come across. They are on the statement so the gap
 * between what was worked and what was billed stays visible there, but a
 * client's invoice should show what they owe and not a list of things they
 * were not charged for.
 */
export class RaiseInvoice {
  constructor(
    private readonly statements: StatementRepository,
    private readonly invoices: InvoiceRepository,
    private readonly numbering: InvoiceNumbering,
    private readonly settings: BillingSettings,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    issuedBy: string,
    statementId: string,
  ): Promise<Result<{ invoiceId: string; number: string }, Conflict>> {
    const statement = await this.statements.findById(statementId);
    if (!statement) return err(new Conflict('There is no such statement'));

    /*
     * The billable-state check.
     *
     * Only an approved statement bills. A draft is still being argued over and
     * an already-invoiced one would bill the same hours twice — which the
     * client notices and the firm cannot explain.
     */
    if (statement.currentState !== 'approved') {
      return err(
        new Conflict(
          statement.currentState === 'invoiced'
            ? 'That statement has already been invoiced'
            : 'Only an approved statement can be invoiced',
        ),
      );
    }

    const snapshot = statement.snapshot();
    const lines: InvoiceLine[] = snapshot.lines
      .filter((line) => !line.excluded)
      .map((line) => ({
        id: this.ids.next(),
        // Copied, not referenced. The statement can be reopened and a rate can
        // change; a document the client holds may not.
        projectId: line.projectId,
        service: line.service,
        descriptionEn: describe(line.service, line.performedOn, 'en'),
        descriptionAr: describe(line.service, line.performedOn, 'ar'),
        worked: line.worked,
        amount: lineAmount(line),
        ...printedAs(line),
      }));

    if (lines.length === 0) {
      return err(
        new Conflict('Every line on that statement was excluded; there is nothing to bill'),
      );
    }

    const issuedOn = this.clock.now();
    const dueOn = new Date(issuedOn.getTime() + this.settings.paymentTermsDays * 86_400_000);
    const number = await this.numbering.next();

    const invoice = Invoice.raise({
      id: this.ids.next(),
      clientId: snapshot.clientId,
      statementId,
      number,
      currency: snapshot.currency,
      lines,
      vatBasisPoints: this.settings.vatBasisPoints,
      issuedOn,
      dueOn,
      issuedBy,
    });
    if (!invoice.ok) return err(invoice.error);

    await this.invoices.save(invoice.value);

    /*
     * The statement is marked after the invoice exists.
     *
     * The other order would leave a statement claiming to be invoiced with no
     * invoice behind it, and the hours on it frozen against a document nobody
     * can find. This order, at worst, leaves an approved statement that has
     * been billed — visible, and fixable by somebody who can read both.
     */
    const marked = statement.markInvoiced(issuedOn);
    if (!marked.ok) return err(marked.error);
    await this.statements.save(statement);

    return ok({ invoiceId: invoice.value.id, number });
  }
}

/**
 * What a line says on the client's document.
 *
 * The service and the month, not the project id: a client reads "VAT return,
 * September 2026" and cannot do anything with `t-01M2N0...`. The project is still
 * on the line, where the firm and an auditor can find it.
 */
function describe(service: string, performedOn: Date, language: 'en' | 'ar'): string {
  const month = performedOn.toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
  });
  const names: Record<string, { en: string; ar: string }> = {
    vat_return: { en: 'VAT return', ar: 'الإقرار الضريبي' },
    ct_return: { en: 'Corporate tax return', ar: 'إقرار ضريبة الشركات' },
    monthly_accounting: { en: 'Monthly accounting', ar: 'المحاسبة الشهرية' },
    bookkeeping: { en: 'Bookkeeping', ar: 'مسك الدفاتر' },
  };
  const name = names[service] ?? { en: 'Professional services', ar: 'خدمات مهنية' };
  return `${name[language]} — ${month}`;
}

/**
 * The Qty and Rate the document prints for a line.
 *
 * An hourly line prints its hours at the rate they were billed at; a fixed
 * fee prints one, at the fee. An adjusted or excluded line is the awkward
 * case: its amount is no longer quantity times rate, and printing the
 * original two would show arithmetic that does not reach the total on the
 * same page. Those print as one, at whatever they came to.
 */
function printedAs(line: StatementLine): { quantityCenti: number; unitRate: Money | null } {
  const charged = lineAmount(line);
  const asWorked = line.adjustedTo === null && !line.excluded;

  if (!asWorked) return { quantityCenti: 100, unitRate: charged };
  if (line.pricing.kind === 'fixed') return { quantityCenti: 100, unitRate: line.pricing.fee };

  // Hundredths of an hour, rounded the one way the kernel rounds.
  const centi = Math.round((line.worked.seconds * 100) / 3600);
  return centi > 0
    ? { quantityCenti: centi, unitRate: line.pricing.perHour }
    : { quantityCenti: 100, unitRate: charged };
}
