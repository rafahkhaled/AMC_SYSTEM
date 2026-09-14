import type { Duration } from './duration.js';
import { SECONDS_PER_HOUR } from './duration.js';
import { ProgrammerError } from './errors.js';
import type { CurrencyCode, Money } from './money.js';

/**
 * An hourly rate. Turning recorded time into an amount happens here and only
 * here, so the rounding rule behind every line of a client statement is a
 * single, testable function.
 */
export class Rate {
  private constructor(readonly perHour: Money) {}

  static perHour(amount: Money): Rate {
    if (amount.isNegative()) {
      throw new ProgrammerError('An hourly rate cannot be negative');
    }
    return new Rate(amount);
  }

  get currency(): CurrencyCode {
    return this.perHour.currency;
  }

  /** What the given time is worth at this rate, rounded half away from zero. */
  amountFor(duration: Duration): Money {
    return this.perHour.scaleByRatio(duration.seconds, SECONDS_PER_HOUR);
  }

  equals(other: Rate): boolean {
    return this.perHour.equals(other.perHour);
  }

  toJSON(): { perHour: ReturnType<Money['toJSON']> } {
    return { perHour: this.perHour.toJSON() };
  }
}
