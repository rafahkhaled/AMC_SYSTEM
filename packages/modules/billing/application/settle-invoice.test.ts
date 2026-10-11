import { Duration, Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Invoice, type InvoiceLine } from '../domain/index.js';
import { SettleInvoice } from './settle-invoice.js';
import { CountingIds, FakeClock, InMemoryInvoices } from './test-doubles.js';

const issued = new Date('2026-10-01T08:00:00.000Z');
const due = new Date('2026-10-31T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');
const actor = { userId: 'u-1', roles: ['manager'], label: 'Wael' };

const line: InvoiceLine = {
  id: 'il-1',
  projectId: 't-1',
  service: 'vat_return',
  descriptionEn: 'VAT return',
  descriptionAr: 'الإقرار الضريبي',
  worked: Duration.ofHours(2),
  quantityCenti: 200,
  unitRate: aed(30_000),
  amount: aed(60_000),
};

function invoiceOf(id: string, dueOn = due) {
  const made = Invoice.raise({
    id,
    clientId: 'c-1',
    statementId: `s-${id}`,
    number: `INV-${id}`,
    currency: 'AED',
    lines: [line],
    vatBasisPoints: 0,
    issuedOn: issued,
    dueOn,
    issuedBy: 'u-1',
  });
  if (!made.ok) throw made.error;
  made.value.pullEvents();
  return made.value;
}

/** The payment methods on the list, as Settings would have them. */
const methods = (
  live: readonly string[] = ['bank_transfer', 'cheque', 'cash', 'card', 'other'],
) => ({
  isLive: async (list: string, code: string) => list === 'payment_method' && live.includes(code),
});

async function harness(at: Date, invoices: Invoice[] = [invoiceOf('inv-1')]) {
  const repository = new InMemoryInvoices();
  for (const invoice of invoices) await repository.save(invoice);
  const settle = new SettleInvoice(repository, new FakeClock(at), new CountingIds(), methods());
  return { settle, repository };
}

describe('recording money received', () => {
  it('takes a partial payment and reports what is left', async () => {
    const h = await harness(issued);
    const recorded = await h.settle.record(actor, {
      invoiceId: 'inv-1',
      amountMinor: 20_000,
      receivedOn: new Date('2026-10-10T00:00:00Z'),
      method: 'bank_transfer',
      reference: 'FT123',
    });

    expect(recorded.ok).toBe(true);
    if (recorded.ok) expect(recorded.value.balanceMinor).toBe(40_000);
  });

  it('settles it when the rest arrives', async () => {
    const h = await harness(issued);
    await h.settle.record(actor, {
      invoiceId: 'inv-1',
      amountMinor: 20_000,
      receivedOn: new Date('2026-10-10T00:00:00Z'),
      method: 'bank_transfer',
    });
    const final = await h.settle.record(actor, {
      invoiceId: 'inv-1',
      amountMinor: 40_000,
      receivedOn: new Date('2026-10-20T00:00:00Z'),
      method: 'cheque',
    });

    expect(final.ok).toBe(true);
    expect((await h.repository.findById('inv-1'))?.status()).toBe('paid');
  });

  it('records who took the payment', async () => {
    const h = await harness(issued);
    await h.settle.record(actor, {
      invoiceId: 'inv-1',
      amountMinor: 1000,
      receivedOn: new Date('2026-10-10T00:00:00Z'),
      method: 'cash',
    });
    const invoice = await h.repository.findById('inv-1');
    expect(invoice?.snapshot().payments[0]?.recordedBy).toBe('u-1');
  });

  it('says so when the invoice is not there', async () => {
    const h = await harness(issued);
    const refused = await h.settle.record(actor, {
      invoiceId: 'nope',
      amountMinor: 1000,
      receivedOn: issued,
      method: 'cash',
    });
    expect(refused.ok).toBe(false);
  });
});

describe('the morning sweep', () => {
  it('marks what is late and leaves what is not', async () => {
    const h = await harness(new Date('2026-11-05T06:00:00Z'), [
      invoiceOf('inv-late', due),
      invoiceOf('inv-soon', new Date('2026-12-31T00:00:00Z')),
    ]);

    const swept = await h.settle.sweepOverdue();
    expect(swept.marked).toBe(1);
    expect((await h.repository.findById('inv-late'))?.status()).toBe('overdue');
    expect((await h.repository.findById('inv-soon'))?.status()).toBe('issued');
  });

  it('does not reset the day something became late', async () => {
    const h = await harness(new Date('2026-11-05T06:00:00Z'));
    await h.settle.sweepOverdue();
    const first = (await h.repository.findById('inv-1'))?.snapshot().overdueSince;

    // The follow-up ladder counts days from this date. A sweep that reset it
    // each morning would mean nothing ever escalated.
    const later = new SettleInvoice(
      h.repository,
      new FakeClock(new Date('2026-11-20T06:00:00Z')),
      new CountingIds(),
      methods(),
    );
    const again = await later.sweepOverdue();

    expect(again.marked).toBe(0);
    expect(again.skipped).toBe(1);
    expect((await h.repository.findById('inv-1'))?.snapshot().overdueSince).toEqual(first);
  });

  it('ignores an invoice that was paid before anyone looked', async () => {
    const h = await harness(new Date('2026-11-05T06:00:00Z'));
    await h.settle.record(actor, {
      invoiceId: 'inv-1',
      amountMinor: 60_000,
      receivedOn: new Date('2026-10-20T00:00:00Z'),
      method: 'bank_transfer',
    });

    const swept = await h.settle.sweepOverdue();
    expect(swept.marked).toBe(0);
    expect((await h.repository.findById('inv-1'))?.status()).toBe('paid');
  });

  it('marks a part-paid invoice late, and keeps both facts', async () => {
    const h = await harness(new Date('2026-11-05T06:00:00Z'));
    await h.settle.record(actor, {
      invoiceId: 'inv-1',
      amountMinor: 20_000,
      receivedOn: new Date('2026-10-20T00:00:00Z'),
      method: 'bank_transfer',
    });

    await h.settle.sweepOverdue();
    const invoice = await h.repository.findById('inv-1');

    expect(invoice?.isOverdue).toBe(true);
    expect(invoice?.snapshot().settlement).toBe('part_paid');
    expect(invoice?.balance().minorUnits).toBe(40_000);
  });

  it('keeps going when one invoice refuses', async () => {
    // A sweep that abandons its batch on the first problem leaves the rest
    // unmarked, and nobody notices until a client is chased a fortnight late.
    const cancelled = invoiceOf('inv-cancelled', due);
    cancelled.cancel('raised against the wrong client', issued);
    cancelled.pullEvents();

    const h = await harness(new Date('2026-11-05T06:00:00Z'), [
      cancelled,
      invoiceOf('inv-late', due),
    ]);

    const swept = await h.settle.sweepOverdue();
    expect(swept.marked).toBe(1);
    expect((await h.repository.findById('inv-late'))?.status()).toBe('overdue');
  });
});

/*
 * Payment methods an administrator adds (feedback item 7's sibling).
 *
 * Settings let somebody add one, and it appeared in the dropdown — and was
 * then refused when the payment was recorded, by a fixed list in the request
 * and again by a constraint on the table.
 */
describe('payment methods from the list in Settings', () => {
  const pay = (method: string) => ({
    invoiceId: 'inv-1',
    amountMinor: 1000,
    receivedOn: new Date('2026-10-12T00:00:00Z'),
    method,
  });

  async function settleWith(live: string[]) {
    const repository = new InMemoryInvoices();
    await repository.save(invoiceOf('inv-1'));
    return new SettleInvoice(
      repository,
      new FakeClock(new Date('2026-10-12T06:00:00Z')),
      new CountingIds(),
      methods(live),
    );
  }

  it('takes a method added in Settings', async () => {
    const settle = await settleWith(['bank_transfer', 'crypto']);
    expect((await settle.record(actor, pay('crypto'))).ok).toBe(true);
  });

  it('refuses one that was never on the list', async () => {
    const settle = await settleWith(['bank_transfer']);
    const refused = await settle.record(actor, pay('barter'));

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('not a way of paying');
  });

  it('refuses one that has been retired', async () => {
    const settle = await settleWith(['bank_transfer']);
    expect((await settle.record(actor, pay('cash'))).ok).toBe(false);
  });
});
