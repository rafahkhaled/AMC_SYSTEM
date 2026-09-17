import { InvariantViolation, Money, Rate, type Result, err, ok } from '@amc/kernel';

export interface RateChange {
  readonly rate: Rate;
  readonly effectiveFrom: Date;
  readonly changedBy: string;
  readonly note?: string | undefined;
}

/**
 * What a client is charged per hour, and what they were charged before
 * (FR-03).
 *
 * The history is the point. An invoice raised in March must use March's rate
 * for ever, even after the rate changes in April, or a statement reprinted
 * later would disagree with the one the client already paid. So this answers
 * "what was the rate on this date?" rather than "what is the rate?".
 */
export class RateHistory {
  private constructor(private readonly changes: readonly RateChange[]) {}

  static empty(): RateHistory {
    return new RateHistory([]);
  }

  static from(changes: readonly RateChange[]): RateHistory {
    return new RateHistory(
      [...changes].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()),
    );
  }

  /**
   * Add a change. Two rates cannot take effect on the same day, because then
   * "the rate on that day" would have two answers and the one chosen would
   * depend on insertion order.
   */
  add(change: RateChange): Result<RateHistory, InvariantViolation> {
    const clash = this.changes.find(
      (existing) => existing.effectiveFrom.getTime() === change.effectiveFrom.getTime(),
    );
    if (clash) {
      return err(
        new InvariantViolation('A rate already takes effect on that date', {
          effectiveFrom: change.effectiveFrom.toISOString(),
        }),
      );
    }
    if (change.rate.perHour.isNegative()) {
      return err(new InvariantViolation('An hourly rate cannot be negative'));
    }
    return ok(RateHistory.from([...this.changes, change]));
  }

  /**
   * The rate in force on a date, or null when none was. Null is not a failure:
   * a client added today has no rate before today, and the caller falls back
   * to the firm's default.
   */
  on(date: Date): Rate | null {
    let current: Rate | null = null;
    for (const change of this.changes) {
      if (change.effectiveFrom.getTime() <= date.getTime()) current = change.rate;
      else break;
    }
    return current;
  }

  currentAt(now: Date, fallback: Rate): Rate {
    return this.on(now) ?? fallback;
  }

  get all(): readonly RateChange[] {
    return this.changes;
  }

  /** What an invoice line would cost, at the rate that applied when worked. */
  valueOf(amount: Money): Money {
    return amount;
  }
}
