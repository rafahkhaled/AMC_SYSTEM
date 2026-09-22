import { Duration, Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Statement, type StatementLine } from '../domain/index.js';
import { RaiseInvoice } from './raise-invoice.js';
import {
  CountingIds,
  CountingNumbers,
  FakeClock,
  InMemoryInvoices,
  InMemoryStatements,
} from './test-doubles.js';

const now = new Date('2026-10-01T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  id: 'sl-1',
  projectId: 't-1',
  service: 'vat_return',
  performedOn: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'u-1',
  worked: Duration.ofHours(2),
  pricing: { kind: 'hourly', perHour: aed(30_000) },
  entryIds: ['e-1'],
  excluded: false,
  excludedReason: null,
  adjustedTo: null,
  adjustedReason: null,
  ...over,
});

function statementOf(lines: StatementLine[], approve = true) {
  const made = Statement.draft({
    id: 's-1',
    clientId: 'c-1',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-09-30T00:00:00.000Z'),
    currency: 'AED',
    lines,
    createdBy: 'u-9',
    now,
  });
  if (!made.ok) throw made.error;
  if (approve) made.value.approve('u-boss', now);
  made.value.pullEvents();
  return made.value;
}

async function harness(statement = statementOf([line()])) {
  const statements = new InMemoryStatements();
  await statements.save(statement);
  const invoices = new InMemoryInvoices();

  const raise = new RaiseInvoice(
    statements,
    invoices,
    new CountingNumbers(),
    { vatBasisPoints: 500, paymentTermsDays: 30 },
    new FakeClock(now),
    new CountingIds(),
  );
  return { raise, statements, invoices, statement };
}

describe('raising an invoice from a statement', () => {
  it('copies the lines and adds VAT', async () => {
    const h = await harness();
    const raised = await h.raise.execute('u-1', 's-1');
    expect(raised.ok).toBe(true);

    const invoice = h.invoices.only();
    expect(invoice.net().minorUnits).toBe(60_000);
    expect(invoice.total().minorUnits).toBe(63_000);
    expect(invoice.snapshot().lines).toHaveLength(1);
  });

  it('keeps the project on every line', async () => {
    const h = await harness();
    await h.raise.execute('u-1', 's-1');

    // Nothing bills without a project, and this is the column that makes a line
    // defensible three years later.
    expect(
      h.invoices
        .only()
        .snapshot()
        .lines.every((line) => line.projectId.length > 0),
    ).toBe(true);
    expect(h.invoices.only().snapshot().lines[0]?.projectId).toBe('t-1');
  });

  it('describes a line in words a client can read, in both languages', async () => {
    const h = await harness();
    await h.raise.execute('u-1', 's-1');
    const [invoiceLine] = h.invoices.only().snapshot().lines;

    // Not the project id: a client can do nothing with t-01M2N0...
    expect(invoiceLine?.descriptionEn).toContain('VAT return');
    expect(invoiceLine?.descriptionEn).toContain('September 2026');
    expect(invoiceLine?.descriptionAr).toContain('الإقرار الضريبي');
  });

  it('sets the due date from the firm’s terms', async () => {
    const h = await harness();
    await h.raise.execute('u-1', 's-1');
    expect(h.invoices.only().snapshot().dueOn.toISOString()).toBe('2026-10-31T08:00:00.000Z');
  });

  it('marks the statement invoiced, after the invoice exists', async () => {
    const h = await harness();
    await h.raise.execute('u-1', 's-1');
    expect(h.statement.currentState).toBe('invoiced');
  });

  it('leaves excluded lines off the client’s document', async () => {
    const statement = statementOf([line({ id: 'a' }), line({ id: 'b', projectId: 't-2' })], false);
    statement.exclude('b', 'written off, client goodwill', now);
    statement.approve('u-boss', now);
    statement.pullEvents();

    const h = await harness(statement);
    await h.raise.execute('u-1', 's-1');

    // Still on the statement, where the gap is visible. Not on the invoice,
    // which should show what is owed rather than what was not charged.
    expect(h.invoices.only().snapshot().lines).toHaveLength(1);
    expect(h.statement.snapshot().lines).toHaveLength(2);
  });

  it('bills an adjusted line at the agreed figure', async () => {
    const statement = statementOf([line()], false);
    statement.adjust('sl-1', aed(50_000), 'agreed 500 with Layla', now);
    statement.approve('u-boss', now);
    statement.pullEvents();

    const h = await harness(statement);
    await h.raise.execute('u-1', 's-1');
    expect(h.invoices.only().net().minorUnits).toBe(50_000);
  });
});

describe('the billable-state check', () => {
  it('refuses a draft statement', async () => {
    const h = await harness(statementOf([line()], false));
    const refused = await h.raise.execute('u-1', 's-1');

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('Only an approved statement');
    expect(h.invoices.saved).toHaveLength(0);
  });

  it('refuses to bill the same statement twice', async () => {
    const h = await harness();
    await h.raise.execute('u-1', 's-1');

    // The client notices being billed twice for one month, and the firm
    // cannot explain it.
    const again = await h.raise.execute('u-1', 's-1');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain('already been invoiced');
    expect(h.invoices.saved).toHaveLength(1);
  });

  it('refuses a statement that does not exist', async () => {
    const h = await harness();
    expect((await h.raise.execute('u-1', 'nope')).ok).toBe(false);
  });
});

describe('numbering', () => {
  it('gives each invoice its own number', async () => {
    const statements = new InMemoryStatements();
    await statements.save(statementOf([line()]));

    const second = Statement.draft({
      id: 's-2',
      clientId: 'c-2',
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-30T00:00:00.000Z'),
      currency: 'AED',
      lines: [line({ id: 'sl-2', projectId: 't-9' })],
      createdBy: 'u-9',
      now,
    });
    if (!second.ok) throw second.error;
    second.value.approve('u-boss', now);
    await statements.save(second.value);

    const invoices = new InMemoryInvoices();
    const raise = new RaiseInvoice(
      statements,
      invoices,
      new CountingNumbers(),
      { vatBasisPoints: 500, paymentTermsDays: 30 },
      new FakeClock(now),
      new CountingIds(),
    );

    const first = await raise.execute('u-1', 's-1');
    const next = await raise.execute('u-1', 's-2');
    if (!first.ok || !next.ok) throw new Error('both should have been raised');

    // Two documents under one reference is a dispute nobody can settle.
    // Plain running integers continuing the firm's own sequence.
    expect(first.value.number).toBe('2071');
    expect(next.value.number).toBe('2072');
  });
});

describe('what the printed document shows in Qty and Rate', () => {
  async function raised(lines: StatementLine[]) {
    const { raise, invoices } = await harness(statementOf(lines));
    const result = await raise.execute('u-boss', 's-1');
    if (!result.ok) throw result.error;
    return invoices.saved[0]?.snapshot().lines ?? [];
  }

  it('prints hours at the rate they were billed at', async () => {
    const [printed] = await raised([line({ worked: Duration.ofHours(2) })]);

    // 2.00 × 300.00 = 600.00, and the three figures agree on the page.
    expect(printed?.quantityCenti).toBe(200);
    expect(printed?.unitRate?.minorUnits).toBe(30_000);
    expect(printed?.amount.minorUnits).toBe(60_000);
  });

  it('prints part hours as part hours', async () => {
    const [printed] = await raised([line({ worked: Duration.ofMinutes(90) })]);
    expect(printed?.quantityCenti).toBe(150);
    expect(printed?.unitRate?.minorUnits).toBe(30_000);
  });

  it('prints a fixed fee as one, at the fee', async () => {
    const [printed] = await raised([
      line({ pricing: { kind: 'fixed', fee: aed(175_000) }, worked: Duration.ofHours(12) }),
    ]);

    // Twelve hours went into it and the client is shown one fee, which is
    // what a fixed fee means and what the firm's own template prints.
    expect(printed?.quantityCenti).toBe(100);
    expect(printed?.unitRate?.minorUnits).toBe(175_000);
    expect(printed?.amount.minorUnits).toBe(175_000);
  });

  it('prints an adjusted line as one, at what it came to', async () => {
    const statement = statementOf([line({ worked: Duration.ofHours(2) })]);
    statement.reopen(now);
    statement.adjust('sl-1', aed(50_000), 'agreed 500 with Layla', now);
    statement.approve('u-boss', now);
    statement.pullEvents();

    const { raise, invoices } = await harness(statement);
    const result = await raise.execute('u-boss', 's-1');
    if (!result.ok) throw result.error;
    const [printed] = invoices.saved[0]?.snapshot().lines ?? [];

    /*
     * 2 × 300 is 600, and this line is being charged at 500. Printing the
     * original quantity and rate would put arithmetic on the page that does
     * not reach the total underneath it, and the client would be right to
     * query it.
     */
    expect(printed?.quantityCenti).toBe(100);
    expect(printed?.unitRate?.minorUnits).toBe(50_000);
    expect(printed?.amount.minorUnits).toBe(50_000);
  });
});
