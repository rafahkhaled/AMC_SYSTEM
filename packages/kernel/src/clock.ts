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
