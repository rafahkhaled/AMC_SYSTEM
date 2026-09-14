import { InvariantViolation, ProgrammerError } from './errors.js';
import { type Result, err, ok } from './result.js';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/**
 * A length of time held as whole seconds. Every recorded hour in the system is
 * one of these, so that a timesheet adds up exactly rather than approximately.
 */
export class Duration {
  private constructor(readonly seconds: number) {}

  static ofSeconds(seconds: number): Duration {
    if (!Number.isSafeInteger(seconds)) {
      throw new ProgrammerError(`Duration takes whole seconds, received ${seconds}`);
    }
    return new Duration(seconds);
  }

  static ofMinutes(minutes: number): Duration {
    return Duration.ofSeconds(minutes * SECONDS_PER_MINUTE);
  }

  static ofHours(hours: number): Duration {
    return Duration.ofSeconds(Math.round(hours * SECONDS_PER_HOUR));
  }

  static zero(): Duration {
    return new Duration(0);
  }

  /**
   * The span between two instants, truncated to whole seconds. Throws when the
   * end precedes the start, which is a bug in the caller. Use tryBetween for
   * input that came from a device whose clock cannot be trusted.
   */
  static between(start: Date, end: Date): Duration {
    const result = Duration.tryBetween(start, end);
    if (!result.ok) throw new ProgrammerError(result.error.message);
    return result.value;
  }

  /** The span between two instants, or a domain error when time ran backwards. */
  static tryBetween(start: Date, end: Date): Result<Duration, InvariantViolation> {
    const milliseconds = end.getTime() - start.getTime();
    if (Number.isNaN(milliseconds)) {
      return err(new InvariantViolation('A timer reading was not a valid instant'));
    }
    if (milliseconds < 0) {
      return err(
        new InvariantViolation('A time entry cannot end before it started', {
          start: start.toISOString(),
          end: end.toISOString(),
        }),
      );
    }
    return ok(new Duration(Math.floor(milliseconds / 1000)));
  }

  plus(other: Duration): Duration {
    return Duration.ofSeconds(this.seconds + other.seconds);
  }

  minus(other: Duration): Duration {
    return Duration.ofSeconds(this.seconds - other.seconds);
  }

  compare(other: Duration): -1 | 0 | 1 {
    if (this.seconds < other.seconds) return -1;
    return this.seconds > other.seconds ? 1 : 0;
  }

  equals(other: Duration): boolean {
    return this.seconds === other.seconds;
  }

  isZero(): boolean {
    return this.seconds === 0;
  }

  isNegative(): boolean {
    return this.seconds < 0;
  }

  /** Decimal hours for display and reports only. Never bill from this. */
  toDecimalHours(places = 2): number {
    const factor = 10 ** places;
    return Math.round((this.seconds / SECONDS_PER_HOUR) * factor) / factor;
  }

  /** "7:30" for seven and a half hours. */
  toHoursAndMinutes(): string {
    const sign = this.seconds < 0 ? '-' : '';
    const absolute = Math.abs(this.seconds);
    const hours = Math.floor(absolute / SECONDS_PER_HOUR);
    const minutes = Math.floor((absolute % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return `${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
  }

  toJSON(): number {
    return this.seconds;
  }

  static sum(durations: readonly Duration[]): Duration {
    return durations.reduce((total, duration) => total.plus(duration), Duration.zero());
  }
}

export { SECONDS_PER_HOUR };
