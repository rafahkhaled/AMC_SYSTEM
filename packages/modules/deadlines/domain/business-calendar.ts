/**
 * Which days the authority is open.
 *
 * The UAE weekend moved to Saturday and Sunday in January 2022, so Friday is a
 * working day. Getting that backwards would shift every deadline in the system
 * by two days, in the direction that makes them late.
 *
 * Holidays are supplied as data rather than written in here, because most of
 * them follow the lunar calendar and are announced by the government each
 * year. A rule in code that computes Eid would be wrong most years; a table
 * someone updates each December is right every year.
 */
export const WEEKEND_DAYS = [6, 0] as const; // Saturday, Sunday

export interface Holiday {
  /** The calendar date in Dubai, as YYYY-MM-DD. */
  readonly date: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

export class BusinessCalendar {
  private readonly holidays: Map<string, Holiday>;

  constructor(holidays: readonly Holiday[] = []) {
    this.holidays = new Map(holidays.map((holiday) => [holiday.date, holiday]));
  }

  isWeekend(date: Date): boolean {
    return (WEEKEND_DAYS as readonly number[]).includes(date.getUTCDay());
  }

  holidayOn(date: Date): Holiday | null {
    return this.holidays.get(isoDay(date)) ?? null;
  }

  isBusinessDay(date: Date): boolean {
    return !this.isWeekend(date) && this.holidayOn(date) === null;
  }

  /**
   * The next day the authority is open, including today if it is one.
   *
   * A deadline that lands on a weekend or a holiday moves forward, never back:
   * the authority cannot accept a filing on a day it is closed, and moving
   * backwards would shorten the time available.
   */
  nextBusinessDay(date: Date): Date {
    const candidate = new Date(date.getTime());
    // A guard rather than a while(true): a calendar misconfigured with a year
    // of holidays should fail loudly instead of hanging.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (this.isBusinessDay(candidate)) return candidate;
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    throw new Error(
      `No business day found within 30 days of ${isoDay(date)}. The holiday calendar is wrong.`,
    );
  }

  /** The previous open day, for counting backwards from a deadline. */
  previousBusinessDay(date: Date): Date {
    const candidate = new Date(date.getTime());
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (this.isBusinessDay(candidate)) return candidate;
      candidate.setUTCDate(candidate.getUTCDate() - 1);
    }
    throw new Error(
      `No business day found within 30 days before ${isoDay(date)}. The holiday calendar is wrong.`,
    );
  }

  /** How many open days lie between two dates, excluding the first. */
  businessDaysBetween(from: Date, to: Date): number {
    if (to.getTime() <= from.getTime()) return 0;
    const cursor = new Date(from.getTime());
    let count = 0;
    while (cursor.getTime() < to.getTime()) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (this.isBusinessDay(cursor)) count += 1;
    }
    return count;
  }

  get known(): Holiday[] {
    return [...this.holidays.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}
