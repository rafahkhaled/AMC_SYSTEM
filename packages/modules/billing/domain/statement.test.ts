import { Duration, Money } from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import { Statement, type StatementLine, lineAmount } from './statement.js';

const now = new Date('2026-09-21T08:00:00.000Z');
const aed = (minor: number) => Money.ofMinor(minor, 'AED');

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  id: 'sl-1',
  taskId: 't-1',
  service: 'vat_return',
  performedOn: new Date('2026-09-03T00:00:00.000Z'),
  userId: 'u-1',
  worked: Duration.ofHours(2),
  perHour: aed(30_000),
  entryIds: ['e-1'],
  excluded: false,
  excludedReason: null,
  adjustedTo: null,
  adjustedReason: null,
  ...over,
});

function statement(lines: StatementLine[] = [line()]) {
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
  return made.value;
}

describe('what a line is worth', () => {
  it('is the hours at the rate that applied the day they were worked', () => {
    expect(lineAmount(line()).minorUnits).toBe(60_000);
  });

  it('prices part hours exactly', () => {
    // 1h30 at 300.00 is 450.00, and never 449.99.
    expect(lineAmount(line({ worked: Duration.ofMinutes(90) })).minorUnits).toBe(45_000);
  });

  it('is nothing when excluded', () => {
    expect(lineAmount(line({ excluded: true, excludedReason: 'goodwill' })).isZero()).toBe(true);
  });

  it('is the adjusted figure when one was agreed', () => {
    const adjusted = line({ adjustedTo: aed(50_000), adjustedReason: 'agreed 500 with Layla' });
    expect(lineAmount(adjusted).minorUnits).toBe(50_000);
  });

  it('counts an exclusion ahead of an adjustment', () => {
    // A line both adjusted and then excluded is off the bill entirely.
    const both = line({
      excluded: true,
      excludedReason: 'not chargeable after all',
      adjustedTo: aed(50_000),
      adjustedReason: 'agreed 500',
    });
    expect(lineAmount(both).isZero()).toBe(true);
  });
});

describe('drafting a statement', () => {
  it('adds up what will be billed', () => {
    const s = statement([line(), line({ id: 'sl-2', worked: Duration.ofHours(1) })]);
    expect(s.total().minorUnits).toBe(90_000);
    expect(s.totalWorked().seconds).toBe(3 * 3600);
  });

  it('refuses a period that ends before it starts', () => {
    const made = Statement.draft({
      id: 's-2',
      clientId: 'c-1',
      periodStart: new Date('2026-09-30T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      currency: 'AED',
      lines: [],
      createdBy: 'u-9',
      now,
    });
    expect(made.ok).toBe(false);
  });

  it('refuses a line priced in another currency', () => {
    const made = Statement.draft({
      id: 's-3',
      clientId: 'c-1',
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-30T00:00:00.000Z'),
      currency: 'AED',
      lines: [line({ perHour: Money.ofMinor(100, 'USD') })],
      createdBy: 'u-9',
      now,
    });
    expect(made.ok).toBe(false);
  });

  it('bills each line at its own day rate', () => {
    // The firm raised its rate in the middle of the period. February's work
    // stays on February's rate, which is the point of effective dating.
    const s = statement([
      line({ id: 'a', perHour: aed(30_000) }),
      line({ id: 'b', perHour: aed(40_000), performedOn: new Date('2026-09-20T00:00:00.000Z') }),
    ]);
    expect(s.total().minorUnits).toBe(140_000);
  });
});

describe('reviewing it', () => {
  it('excludes a line, with a reason, and keeps it visible', () => {
    const s = statement();
    expect(s.exclude('sl-1', 'written off, client goodwill', now).ok).toBe(true);

    expect(s.total().isZero()).toBe(true);
    // Still on the document, so the gap between worked and billed can be seen.
    expect(s.snapshot().lines).toHaveLength(1);
    expect(s.totalAsWorked().minorUnits).toBe(60_000);
    expect(s.snapshot().lines[0]?.excludedReason).toBe('written off, client goodwill');
  });

  it('refuses an exclusion with no reason worth reading', () => {
    const s = statement();
    expect(s.exclude('sl-1', '', now).ok).toBe(false);
    expect(s.exclude('sl-1', 'x', now).ok).toBe(false);
    expect(s.exclude('sl-1', '   ', now).ok).toBe(false);
  });

  it('restores an excluded line', () => {
    const s = statement();
    s.exclude('sl-1', 'written off', now);
    expect(s.restore('sl-1', now).ok).toBe(true);
    expect(s.total().minorUnits).toBe(60_000);
    expect(s.restore('sl-1', now).ok).toBe(false);
  });

  it('adjusts a line to an agreed figure, with a reason', () => {
    const s = statement();
    expect(s.adjust('sl-1', aed(50_000), 'agreed 500 with Layla on the call', now).ok).toBe(true);
    expect(s.total().minorUnits).toBe(50_000);
  });

  it('refuses a negative adjustment, and one in another currency', () => {
    const s = statement();
    expect(s.adjust('sl-1', aed(-1), 'a reason', now).ok).toBe(false);
    expect(s.adjust('sl-1', Money.ofMinor(100, 'USD'), 'a reason', now).ok).toBe(false);
  });

  it('records every revision as an event carrying the reason', () => {
    const s = statement();
    s.adjust('sl-1', aed(50_000), 'agreed 500 with Layla', now);

    const [event] = s.pullEvents();
    expect(event?.name).toBe('billing.statement.line_revised');
    expect(event?.payload).toMatchObject({
      lineId: 'sl-1',
      adjustedToMinor: 50_000,
      reason: 'agreed 500 with Layla',
    });
  });

  it('says so when the line is not there', () => {
    expect(statement().exclude('nope', 'a reason', now).ok).toBe(false);
  });
});

describe('approving', () => {
  it('approves, and records who and what', () => {
    const s = statement();
    expect(s.approve('u-boss', now).ok).toBe(true);
    expect(s.currentState).toBe('approved');
    expect(s.snapshot().approvedBy).toBe('u-boss');

    const [event] = s.pullEvents();
    expect(event?.name).toBe('billing.statement.approved');
    expect(event?.payload).toMatchObject({ totalMinor: 60_000 });
  });

  it('refuses a statement with nothing on it', () => {
    expect(statement([]).approve('u-boss', now).ok).toBe(false);
  });

  it('refuses one where every line has been excluded', () => {
    // An invoice for zero confuses the client and the ledger equally.
    const s = statement();
    s.exclude('sl-1', 'written off entirely', now);
    const refused = s.approve('u-boss', now);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('nothing to bill');
  });

  it('cannot be edited once approved', () => {
    const s = statement();
    s.approve('u-boss', now);
    expect(s.exclude('sl-1', 'too late', now).ok).toBe(false);
    expect(s.adjust('sl-1', aed(1), 'too late', now).ok).toBe(false);
  });

  it('reopens for more work, clearing who approved it', () => {
    const s = statement();
    s.approve('u-boss', now);
    expect(s.reopen(now).ok).toBe(true);
    expect(s.currentState).toBe('draft');
    expect(s.snapshot().approvedBy).toBeNull();
    expect(s.exclude('sl-1', 'on reflection, goodwill', now).ok).toBe(true);
  });
});

describe('invoicing and cancelling', () => {
  it('marks invoiced only from approved', () => {
    const s = statement();
    expect(s.markInvoiced(now).ok).toBe(false);
    s.approve('u-boss', now);
    expect(s.markInvoiced(now).ok).toBe(true);
    expect(s.currentState).toBe('invoiced');
  });

  it('will not cancel one that has been invoiced', () => {
    const s = statement();
    s.approve('u-boss', now);
    s.markInvoiced(now);

    // The hours are frozen and an invoice exists; cancelling would orphan it.
    const refused = s.cancel(now);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('credit the invoice');
  });

  it('cancels a draft', () => {
    const s = statement();
    expect(s.cancel(now).ok).toBe(true);
    expect(s.currentState).toBe('cancelled');
  });

  it('names every time entry behind it, which is what gets frozen', () => {
    const s = statement([
      line({ id: 'a', entryIds: ['e-1', 'e-2'] }),
      line({ id: 'b', entryIds: ['e-3'] }),
    ]);
    expect([...s.entryIds()].sort()).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('counts an excluded line’s entries too', () => {
    // They were on the statement and must not be picked up by the next one,
    // or the client is billed for hours somebody deliberately wrote off.
    const s = statement([
      line({ id: 'a', entryIds: ['e-1'], excluded: true, excludedReason: 'x' }),
    ]);
    expect(s.entryIds()).toEqual(['e-1']);
  });
});
