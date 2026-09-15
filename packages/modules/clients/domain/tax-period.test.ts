import { describe, expect, it } from 'vitest';
import { FinancialYear, VatPeriods } from './tax-period.js';

const quarterly = (anchor: number) => {
  const periods = VatPeriods.of('quarterly', anchor);
  if (!periods.ok) throw new Error('fixture');
  return periods.value;
};

describe('VAT periods', () => {
  it('rejects a month that is not a month', () => {
    for (const month of [0, 13, -1, 1.5, Number.NaN]) {
      expect(VatPeriods.of('quarterly', month).ok).toBe(false);
    }
  });

  it('gives calendar quarters for a client on the January cycle', () => {
    expect(quarterly(3).endMonths()).toEqual([3, 6, 9, 12]);
  });

  it('gives staggered quarters for a client the authority put on another cycle', () => {
    // The rule that matters. The FTA assigns each business its own cycle, so
    // assuming calendar quarters is right for a third of clients and
    // confidently wrong for the rest.
    expect(quarterly(1).endMonths()).toEqual([1, 4, 7, 10]);
    expect(quarterly(2).endMonths()).toEqual([2, 5, 8, 11]);
  });

  it('treats a monthly filer as ending every month', () => {
    const monthly = VatPeriods.of('monthly', 1);
    expect(monthly.ok && monthly.value.endMonths()).toHaveLength(12);
  });

  it('finds the period a date falls in, on a calendar cycle', () => {
    const period = quarterly(3).periodContaining(new Date('2026-05-14T00:00:00Z'));
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('finds the period on a staggered cycle, where the naive answer differs', () => {
    // A client whose quarters end in January, April, July and October. The
    // 14th of May is in the May-to-July period, not April-to-June.
    const period = quarterly(1).periodContaining(new Date('2026-05-14T00:00:00Z'));
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-05-01');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('handles a period that runs across the turn of the year', () => {
    const period = quarterly(1).periodContaining(new Date('2026-12-05T00:00:00Z'));
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(period.end.toISOString().slice(0, 10)).toBe('2027-01-31');
  });

  it('ends February on the right day in a leap year', () => {
    expect(
      quarterly(2)
        .periodContaining(new Date('2028-01-15T00:00:00Z'))
        .end.toISOString()
        .slice(0, 10),
    ).toBe('2028-02-29');
    expect(
      quarterly(2)
        .periodContaining(new Date('2026-01-15T00:00:00Z'))
        .end.toISOString()
        .slice(0, 10),
    ).toBe('2026-02-28');
  });

  it('labels a period so the same one is never created twice', () => {
    // The key is what stops the scheduler producing a second return task for
    // a quarter it already handled.
    expect(quarterly(3).periodContaining(new Date('2026-05-14T00:00:00Z')).key).toBe('2026-Q2-06');
    const monthly = VatPeriods.of('monthly', 1);
    expect(monthly.ok && monthly.value.periodContaining(new Date('2026-05-14T00:00:00Z')).key).toBe(
      '2026-05',
    );
  });

  it('gives the same period for every day inside it', () => {
    const periods = quarterly(3);
    const first = periods.periodContaining(new Date('2026-04-01T00:00:00Z'));
    const middle = periods.periodContaining(new Date('2026-05-17T00:00:00Z'));
    const last = periods.periodContaining(new Date('2026-06-30T00:00:00Z'));
    expect(first.key).toBe(middle.key);
    expect(middle.key).toBe(last.key);
  });
});

describe('financial year', () => {
  it('rejects a month that is not a month', () => {
    expect(FinancialYear.endingIn(0).ok).toBe(false);
    expect(FinancialYear.endingIn(13).ok).toBe(false);
  });

  it('finds the year end for a December filer', () => {
    const year = FinancialYear.endingIn(12);
    expect(
      year.ok && year.value.yearEndFor(new Date('2026-05-01T00:00:00Z')).toISOString().slice(0, 10),
    ).toBe('2026-12-31');
  });

  it('rolls into next year when the date is past this year end', () => {
    // A June year end, asked about August: the next year end is the following
    // June, not one that has already passed.
    const year = FinancialYear.endingIn(6);
    expect(
      year.ok && year.value.yearEndFor(new Date('2026-08-01T00:00:00Z')).toISOString().slice(0, 10),
    ).toBe('2027-06-30');
  });

  it('treats the year end day itself as inside that year', () => {
    const year = FinancialYear.endingIn(6);
    expect(
      year.ok && year.value.yearEndFor(new Date('2026-06-30T00:00:00Z')).toISOString().slice(0, 10),
    ).toBe('2026-06-30');
  });

  it('labels the year, for the return it produces', () => {
    const year = FinancialYear.endingIn(3);
    expect(year.ok && year.value.keyFor(new Date('2026-08-01T00:00:00Z'))).toBe('FY2027');
  });
});
