import { Duration, Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Invoice, type InvoiceLine, type Payment } from './invoice.js';

const issued = new Date('2026-10-01T08:00:00.000Z');
const due = new Date('2026-10-31T00:00:00.000Z');
/** A date relative to the due date. Not named `after`: that is a test hook. */
const afterDue = (days: number) => new Date(due.getTime() + days * 86_400_000);
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  id: 'il-1',
  projectId: 't-1',
  service: 'vat_return',
  descriptionEn: 'VAT return, Q3',
  descriptionAr: 'الإقرار الضريبي، الربع الثالث',
  quantityCenti: 200,
  unitRate: aed(30_000),
  worked: Duration.ofHours(2),
  amount: aed(60_000),
  ...over,
});

function raise(over: Partial<Parameters<typeof Invoice.raise>[0]> = {}) {
  const made = Invoice.raise({
    id: 'inv-1',
    clientId: 'c-1',
    statementId: 's-1',
    number: '2071',
    currency: 'AED',
    lines: [line()],
    vatBasisPoints: 500,
    issuedOn: issued,
    dueOn: due,
    issuedBy: 'u-1',
    ...over,
  });
  if (!made.ok) throw made.error;
  made.value.pullEvents();
  return made.value;
}

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'p-1',
  amount: aed(63_000),
  receivedOn: afterDue(-5),
  method: 'bank_transfer',
  reference: 'FT2026100112',
  chequeNumber: null,
  chequeDate: null,
  bankName: null,
  discount: Money.zero('AED'),
  discountReason: null,
  recordedBy: 'u-1',
  ...over,
});

describe('raising an invoice', () => {
  it('adds VAT at the rate on the document', () => {
    const invoice = raise();
    expect(invoice.net().minorUnits).toBe(60_000);
    // Five percent of 600.00 is 30.00.
    expect(invoice.vat().minorUnits).toBe(3_000);
    expect(invoice.total().minorUnits).toBe(63_000);
  });

  it('charges no VAT for a firm that is not registered', () => {
    const invoice = raise({ vatBasisPoints: 0 });
    expect(invoice.vat().isZero()).toBe(true);
    expect(invoice.total().minorUnits).toBe(60_000);
  });

  it('refuses a line with no project against it', () => {
    // Nothing bills without a project (ERD rule 4).
    const made = Invoice.raise({
      id: 'inv-2',
      clientId: 'c-1',
      statementId: 's-1',
      number: 'INV-2',
      currency: 'AED',
      lines: [line({ projectId: '  ' })],
      vatBasisPoints: 500,
      issuedOn: issued,
      dueOn: due,
      issuedBy: 'u-1',
    });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toContain('name the project');
  });

  it('refuses an invoice with no lines, no number, or a due date before it was issued', () => {
    const base = {
      id: 'inv-3',
      clientId: 'c-1',
      statementId: 's-1',
      number: 'INV-3',
      currency: 'AED' as const,
      lines: [line()],
      vatBasisPoints: 500,
      issuedOn: issued,
      dueOn: due,
      issuedBy: 'u-1',
    };
    expect(Invoice.raise({ ...base, lines: [] }).ok).toBe(false);
    expect(Invoice.raise({ ...base, number: '  ' }).ok).toBe(false);
    expect(Invoice.raise({ ...base, dueOn: new Date('2026-09-01T00:00:00Z') }).ok).toBe(false);
  });

  it('refuses a nonsense VAT rate', () => {
    expect(raise.bind(null, { vatBasisPoints: -1 })).toThrow();
    expect(raise.bind(null, { vatBasisPoints: 10_001 })).toThrow();
  });

  it('announces itself with the figure on it', () => {
    const made = Invoice.raise({
      id: 'inv-4',
      clientId: 'c-1',
      statementId: 's-1',
      number: 'INV-4',
      currency: 'AED',
      lines: [line()],
      vatBasisPoints: 500,
      issuedOn: issued,
      dueOn: due,
      issuedBy: 'u-1',
    });
    if (!made.ok) throw made.error;
    const [event] = made.value.pullEvents();
    expect(event?.name).toBe('billing.invoice.raised');
    expect(event?.payload).toMatchObject({ totalMinor: 63_000, number: 'INV-4' });
  });
});

describe('payments', () => {
  it('settles the invoice when the full amount arrives', () => {
    const invoice = raise();
    expect(invoice.recordPayment(payment()).ok).toBe(true);

    expect(invoice.status()).toBe('paid');
    expect(invoice.balance().isZero()).toBe(true);
  });

  it('takes a partial payment and keeps the balance', () => {
    const invoice = raise();
    expect(invoice.recordPayment(payment({ amount: aed(20_000) })).ok).toBe(true);

    expect(invoice.status()).toBe('part_paid');
    expect(invoice.balance().minorUnits).toBe(43_000);
  });

  it('adds several payments up', () => {
    const invoice = raise();
    invoice.recordPayment(payment({ id: 'p-1', amount: aed(20_000) }));
    invoice.recordPayment(payment({ id: 'p-2', amount: aed(43_000) }));

    expect(invoice.paid().minorUnits).toBe(63_000);
    expect(invoice.status()).toBe('paid');
  });

  it('shows an overpayment as settled rather than a negative balance', () => {
    const invoice = raise();
    invoice.recordPayment(payment({ amount: aed(70_000) }));
    expect(invoice.balance().isZero()).toBe(true);
    expect(invoice.status()).toBe('paid');
  });

  it('refuses the same payment twice', () => {
    const invoice = raise();
    invoice.recordPayment(payment({ amount: aed(1000) }));
    expect(invoice.recordPayment(payment({ amount: aed(1000) })).ok).toBe(false);
  });

  it('refuses money that predates the invoice', () => {
    // It was paid against something else, and recording it here hides what.
    const invoice = raise();
    const refused = invoice.recordPayment(
      payment({ receivedOn: new Date('2026-09-01T00:00:00Z') }),
    );
    expect(refused.ok).toBe(false);
  });

  it('refuses nothing, a negative, and another currency', () => {
    const invoice = raise();
    expect(invoice.recordPayment(payment({ amount: aed(0) })).ok).toBe(false);
    expect(invoice.recordPayment(payment({ amount: aed(-100) })).ok).toBe(false);
    expect(invoice.recordPayment(payment({ amount: Money.ofMinor(100, 'USD') })).ok).toBe(false);
  });

  it('records the balance on the event, so a follow-up knows what to chase', () => {
    const invoice = raise();
    invoice.recordPayment(payment({ amount: aed(20_000) }));

    const [event] = invoice.pullEvents();
    expect(event?.name).toBe('billing.payment.received');
    expect(event?.payload).toMatchObject({ balanceMinor: 43_000, settled: false });
  });
});

describe('falling overdue', () => {
  it('marks it late once the date has passed', () => {
    const invoice = raise();
    expect(invoice.markOverdue(afterDue(1)).ok).toBe(true);

    expect(invoice.status()).toBe('overdue');
    expect(invoice.snapshot().overdueSince).toEqual(afterDue(1));
  });

  it('does not mark it early', () => {
    expect(raise().markOverdue(afterDue(-1)).ok).toBe(false);
  });

  it('keeps the day it became late, however often the sweep runs', () => {
    const invoice = raise();
    invoice.markOverdue(afterDue(1));
    invoice.pullEvents();

    // The follow-up ladder counts days from this date; a sweep that reset it
    // each morning would mean nothing ever escalated.
    expect(invoice.markOverdue(afterDue(5)).ok).toBe(true);
    expect(invoice.snapshot().overdueSince).toEqual(afterDue(1));
    expect(invoice.pullEvents()).toHaveLength(0);
  });

  it('will not mark a settled invoice late', () => {
    const invoice = raise();
    invoice.recordPayment(payment());
    expect(invoice.markOverdue(afterDue(1)).ok).toBe(false);
  });

  it('keeps both facts when a late invoice is part paid', () => {
    const invoice = raise();
    invoice.markOverdue(afterDue(1));
    invoice.recordPayment(payment({ amount: aed(20_000), receivedOn: afterDue(2) }));

    // Still late, and partly paid. A single status field would lose one.
    expect(invoice.isOverdue).toBe(true);
    expect(invoice.snapshot().settlement).toBe('part_paid');
    expect(invoice.balance().minorUnits).toBe(43_000);
    expect(invoice.status()).toBe('overdue');
  });

  it('stops being late the moment it is settled', () => {
    const invoice = raise();
    invoice.markOverdue(afterDue(1));
    invoice.recordPayment(payment({ receivedOn: afterDue(3) }));

    expect(invoice.isOverdue).toBe(false);
    expect(invoice.status()).toBe('paid');
  });
});

describe('cancelling', () => {
  it('cancels an unpaid invoice with a reason', () => {
    const invoice = raise();
    expect(invoice.cancel('raised against the wrong client', issued).ok).toBe(true);
    expect(invoice.status()).toBe('cancelled');
  });

  it('refuses without a reason', () => {
    expect(raise().cancel('  ', issued).ok).toBe(false);
  });

  it('refuses once money has arrived', () => {
    const invoice = raise();
    invoice.recordPayment(payment({ amount: aed(1000) }));

    const refused = invoice.cancel('changed our mind', issued);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('credit it instead');
  });

  it('accepts no payment afterwards', () => {
    const invoice = raise();
    invoice.cancel('duplicate', issued);
    expect(invoice.recordPayment(payment()).ok).toBe(false);
  });
});

describe('a payment with a discount', () => {
  it('settles the invoice when the money and the discount cover it', () => {
    const invoice = raise();
    const total = invoice.total().minorUnits;

    const recorded = invoice.recordPayment(
      payment({
        amount: Money.ofMinor(total - 10_000, 'AED'),
        discount: aed(10_000),
        discountReason: 'agreed 100 off with Layla',
      }),
    );
    expect(recorded.ok).toBe(true);

    /*
     * Counting only the money would leave this on the chase list for ever,
     * which is the thing recording a discount exists to prevent.
     */
    expect(invoice.balance().isZero()).toBe(true);
    expect(invoice.snapshot().settlement).toBe('paid');
  });

  it('keeps what was forgiven out of what was received', () => {
    const invoice = raise();
    invoice.recordPayment(
      payment({ amount: aed(50_000), discount: aed(10_000), discountReason: 'goodwill' }),
    );

    // A report of what the practice took in must not include the part it
    // dropped: the two are different numbers and one of them is not income.
    expect(invoice.paid().minorUnits).toBe(50_000);
    expect(invoice.discounted().minorUnits).toBe(10_000);
  });

  it('carries a cheque its own number and date, which is what gets chased', () => {
    const invoice = raise();
    invoice.recordPayment(
      payment({ method: 'cheque', chequeNumber: '004412', bankName: 'Emirates NBD' }),
    );

    const [recorded] = invoice.snapshot().payments;
    expect(recorded?.chequeNumber).toBe('004412');
    expect(recorded?.bankName).toBe('Emirates NBD');
  });
});
