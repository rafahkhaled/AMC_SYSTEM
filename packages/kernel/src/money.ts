import { ProgrammerError } from './errors.js';

export type CurrencyCode = 'AED' | 'USD' | 'EUR' | 'GBP' | 'SAR';

/** Decimal places each currency carries. The dirham subdivides into 100 fils. */
const MINOR_UNIT_DIGITS: Readonly<Record<CurrencyCode, number>> = {
  AED: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  SAR: 2,
};

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Divide and round half away from zero — the convention every accountant
 * expects on an invoice, and the only rounding rule in this system. It lives
 * here alone so that no other file is ever tempted to invent its own.
 */
function divideRoundingHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new ProgrammerError('Division by zero in Money arithmetic');
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function assertSafeInteger(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ProgrammerError(`Money amount ${value} exceeds the safe integer range`);
  }
  return Number(value);
}

/**
 * An exact amount of money, held as a whole number of minor units — fils for
 * the dirham. There is no floating point anywhere in the billing path, because
 * a statement that disagrees with a hand calculation by one fils is a statement
 * the client stops trusting.
 */
export class Money {
  private constructor(
    /** Whole minor units. 45000 means AED 450.00 */
    readonly minorUnits: number,
    readonly currency: CurrencyCode,
  ) {}

  /** Build from minor units, e.g. fils. */
  static ofMinor(minorUnits: number, currency: CurrencyCode): Money {
    if (!Number.isSafeInteger(minorUnits)) {
      throw new ProgrammerError(`Money minor units must be a whole number, received ${minorUnits}`);
    }
    return new Money(minorUnits, currency);
  }

  /**
   * Build from a major amount such as 1_250.75. Strings are parsed exactly;
   * numbers are rendered to the currency's precision first. More decimals than
   * the currency allows is rejected rather than silently rounded, because
   * silent rounding at the edge of the system is how money goes missing.
   */
  static ofMajor(amount: number | string, currency: CurrencyCode): Money {
    const digits = MINOR_UNIT_DIGITS[currency];
    const text = typeof amount === 'number' ? amount.toFixed(digits) : amount.trim();
    const match = DECIMAL_PATTERN.exec(text);
    if (!match) throw new ProgrammerError(`Cannot read "${amount}" as an amount of ${currency}`);
    const [, sign, whole = '0', fraction = ''] = match;
    if (fraction.length > digits) {
      throw new ProgrammerError(
        `${currency} carries ${digits} decimal places, but "${amount}" has ${fraction.length}`,
      );
    }
    const padded = fraction.padEnd(digits, '0');
    const total = BigInt(whole + padded) * (sign === '-' ? -1n : 1n);
    return new Money(assertSafeInteger(total), currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0, currency);
  }

  private sameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new ProgrammerError(`Cannot mix ${this.currency} with ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.sameCurrency(other);
    return new Money(assertSafeInteger(BigInt(this.minorUnits) + BigInt(other.minorUnits)), this.currency);
  }

  subtract(other: Money): Money {
    this.sameCurrency(other);
    return new Money(assertSafeInteger(BigInt(this.minorUnits) - BigInt(other.minorUnits)), this.currency);
  }

  negated(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  /** Multiply by a whole number, e.g. five copies of the same fee. */
  times(factor: number): Money {
    if (!Number.isSafeInteger(factor)) {
      throw new ProgrammerError(`times() takes a whole number, received ${factor}`);
    }
    return new Money(assertSafeInteger(BigInt(this.minorUnits) * BigInt(factor)), this.currency);
  }

  /**
   * Scale by an exact ratio, rounding half away from zero. Hours against an
   * hourly rate and VAT against a net amount both go through here, so both use
   * the same rounding rule.
   */
  scaleByRatio(numerator: number, denominator: number): Money {
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
      throw new ProgrammerError('scaleByRatio takes whole numbers');
    }
    const scaled = divideRoundingHalfAwayFromZero(
      BigInt(this.minorUnits) * BigInt(numerator),
      BigInt(denominator),
    );
    return new Money(assertSafeInteger(scaled), this.currency);
  }

  /** Apply a percentage given in basis points. 500 basis points is 5 percent. */
  percentageInBasisPoints(basisPoints: number): Money {
    return this.scaleByRatio(basisPoints, 10_000);
  }

  /**
   * Split across weights without losing or inventing a single fils. The
   * remainder goes to the earliest shares, which is the standard largest
   * remainder method.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) throw new ProgrammerError('allocate needs at least one weight');
    if (weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0)) {
      throw new ProgrammerError('allocate takes whole, non-negative weights');
    }
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total === 0) throw new ProgrammerError('allocate needs weights that sum above zero');

    const shares: number[] = [];
    let distributed = 0n;
    for (const weight of weights) {
      const share = (BigInt(this.minorUnits) * BigInt(weight)) / BigInt(total);
      shares.push(Number(share));
      distributed += share;
    }

    let remainder = BigInt(this.minorUnits) - distributed;
    const step = remainder < 0n ? -1 : 1;
    for (let index = 0; remainder !== 0n; index = (index + 1) % shares.length) {
      shares[index] = (shares[index] ?? 0) + step;
      remainder -= BigInt(step);
    }

    return shares.map((minor) => new Money(minor, this.currency));
  }

  compare(other: Money): -1 | 0 | 1 {
    this.sameCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    return this.minorUnits > other.minorUnits ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  isZero(): boolean {
    return this.minorUnits === 0;
  }

  isNegative(): boolean {
    return this.minorUnits < 0;
  }

  isPositive(): boolean {
    return this.minorUnits > 0;
  }

  /** Exact decimal text, e.g. "450.00". Safe for storage and comparison. */
  toMajorString(): string {
    const digits = MINOR_UNIT_DIGITS[this.currency];
    const negative = this.minorUnits < 0;
    const absolute = Math.abs(this.minorUnits).toString().padStart(digits + 1, '0');
    const whole = absolute.slice(0, absolute.length - digits);
    const fraction = absolute.slice(absolute.length - digits);
    return `${negative ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
  }

  /** Localised text for display only. Never parse this back. */
  format(locale = 'en-AE'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: MINOR_UNIT_DIGITS[this.currency],
    }).format(this.minorUnits / 10 ** MINOR_UNIT_DIGITS[this.currency]);
  }

  toJSON(): { minorUnits: number; currency: CurrencyCode } {
    return { minorUnits: this.minorUnits, currency: this.currency };
  }

  static sum(amounts: readonly Money[], currency: CurrencyCode): Money {
    return amounts.reduce((total, amount) => total.add(amount), Money.zero(currency));
  }
}
