import { InvariantViolation } from '@amc/kernel';
import { type Result, err, ok } from '@amc/kernel';

/**
 * An email address, normalised once so that two spellings of the same inbox can
 * never become two accounts. The column is citext as well: belt and braces,
 * because the database is the only place that can promise uniqueness.
 */
export class EmailAddress {
  private constructor(readonly value: string) {}

  static of(raw: string): Result<EmailAddress, InvariantViolation> {
    const normalised = raw.trim().toLowerCase();

    if (normalised.length === 0) {
      return err(new InvariantViolation('An email address is required'));
    }
    if (normalised.length > 254) {
      return err(new InvariantViolation('That email address is too long'));
    }
    // Deliberately permissive. The only proof an address works is a message
    // arriving at it, and an over-strict pattern rejects valid addresses.
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(normalised)) {
      return err(new InvariantViolation('That does not look like an email address'));
    }

    return ok(new EmailAddress(normalised));
  }

  get domain(): string {
    return this.value.slice(this.value.indexOf('@') + 1);
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
