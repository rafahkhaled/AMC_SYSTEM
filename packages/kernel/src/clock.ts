/**
 * Time as a dependency, never as a global. Every deadline rule, escalation and
 * timer reads the clock through this port, which is what makes the VAT engine
 * testable: you set the date to the 27th and assert.
 */
export interface Clock {
  now(): Date;
}

/** The timezone every business rule is expressed in, whatever the server runs. */
export const BUSINESS_TIME_ZONE = 'Asia/Dubai';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock that does not move, for tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(instant: Date): void {
    this.current = new Date(instant.getTime());
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  advanceDays(days: number): void {
    this.advanceSeconds(days * 86_400);
  }
}

/** The calendar date in Dubai for a given instant, as "2026-09-14". */
export function businessDate(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * A `Date` in a form a raw SQL template will bind.
 *
 * Drizzle's `sql` tag passes values straight to the driver, and the driver
 * refuses a `Date`: "The string argument must be of type string". The query
 * builder converts them; a hand-written template does not, and the failure
 * arrives at runtime with a message that names neither the column nor the
 * value. This has cost three separate afternoons, so it lives here rather
 * than being rewritten beside each query.
 *
 * Always cast at the other end, because a string is not a timestamp:
 *
 *   sql`WHERE run_at <= ${at(now)}::timestamptz`
 *   sql`WHERE expires_on < ${on(today)}::date`
 */
export const at = (value: Date): string => value.toISOString();

/** The calendar day of an instant, for a `::date` comparison. */
export const on = (value: Date): string => value.toISOString().slice(0, 10);
