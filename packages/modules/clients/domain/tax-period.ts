import { InvariantViolation, type Result, err, ok } from '@amc/kernel';

export type VatFrequency = 'monthly' | 'quarterly';

/**
 * When a client's VAT periods end.
 *
 * The subtlety that matters: UAE VAT quarters are staggered. The Federal Tax
 * Authority assigns each business its own cycle, so one client files for
 * January to March while another files February to April. Assuming calendar
 * quarters would produce the right answer for roughly a third of clients and a
 * confidently wrong one for the rest.
 *
 * So a client's cycle is described by any month in which one of its periods
 * ends, and the rest follow from the frequency.
 */
export class VatPeriods {
  private constructor(
    readonly frequency: VatFrequency,
    /** 1 to 12. Any month a period ends; the others are derived. */
    readonly anchorEndMonth: number,
  ) {}

  static of(
    frequency: VatFrequency,
    anchorEndMonth: number,
  ): Result<VatPeriods, InvariantViolation> {
    if (!Number.isInteger(anchorEndMonth) || anchorEndMonth < 1 || anchorEndMonth > 12) {
      return err(
        new InvariantViolation('A period end month is between 1 and 12', { anchorEndMonth }),
      );
    }
    return ok(new VatPeriods(frequency, anchorEndMonth));
  }

  /** Every month of the year in which a period ends for this client. */
  endMonths(): number[] {
    if (this.frequency === 'monthly') {
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }
    const months: number[] = [];
    for (let offset = 0; offset < 12; offset += 3) {
      months.push(((this.anchorEndMonth - 1 + offset) % 12) + 1);
    }
    return months.sort((a, b) => a - b);
  }

  endsInMonth(month: number): boolean {
    return this.endMonths().includes(month);
  }

  /**
   * The period containing a date, as the first and last day of it.
   *
   * Returned in UTC, because everything stored is UTC; the business meaning of
   * a date comes from the Dubai calendar and is applied by the caller.
   */
  periodContaining(date: Date): { start: Date; end: Date; key: string } {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const length = this.frequency === 'monthly' ? 1 : 3;

    // Walk back to the start of the period this month belongs to.
    let endMonth = month;
    let endYear = year;
    while (!this.endsInMonth(endMonth)) {
      endMonth += 1;
      if (endMonth > 12) {
        endMonth = 1;
        endYear += 1;
      }
    }

    const start = new Date(Date.UTC(endYear, endMonth - length, 1));
    // Day zero of the next month is the last day of this one, which also gets
    // February right in a leap year without a special case.
    const end = new Date(Date.UTC(endYear, endMonth, 0));

    const key =
      this.frequency === 'monthly'
        ? `${endYear}-${String(endMonth).padStart(2, '0')}`
        : `${endYear}-Q${Math.ceil(endMonth / 3)}-${String(endMonth).padStart(2, '0')}`;

    return { start, end, key };
  }
}

/**
 * A client's financial year, which decides the corporation tax return date.
 *
 * The return is due nine months after the year ends, so a December year end
 * means the following September. Businesses here do not all use December, and
 * the first tax period after the regime began is frequently not twelve months,
 * which is why this is stored per client rather than assumed.
 */
export class FinancialYear {
  private constructor(
    /** 1 to 12: the month the financial year ends. */
    readonly endMonth: number,
  ) {}

  static endingIn(endMonth: number): Result<FinancialYear, InvariantViolation> {
    if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) {
      return err(
        new InvariantViolation('A financial year ends in a month from 1 to 12', { endMonth }),
      );
    }
    return ok(new FinancialYear(endMonth));
  }

  /** The last day of the financial year that contains this date. */
  yearEndFor(date: Date): Date {
    const year = date.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, this.endMonth, 0));
    return date.getTime() <= candidate.getTime()
      ? candidate
      : new Date(Date.UTC(year + 1, this.endMonth, 0));
  }

  /** How that year is labelled, for a task or a filing. */
  keyFor(date: Date): string {
    return `FY${this.yearEndFor(date).getUTCFullYear()}`;
  }
}
