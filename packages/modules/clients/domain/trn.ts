import { InvariantViolation, type Result, err, ok } from '@amc/kernel';

/**
 * A UAE Tax Registration Number: fifteen digits, issued by the Federal Tax
 * Authority.
 *
 * People write it with spaces or dashes because that is how it appears on a
 * certificate, so it is normalised on the way in. Two clients cannot share
 * one, which the database enforces as well.
 *
 * There is no published check digit, so this validates shape and nothing more.
 * Pretending to validate further would give false confidence about a number
 * that is only truly verified by the authority accepting it.
 */
const DIGITS = 15;

export class Trn {
  private constructor(readonly value: string) {}

  static of(raw: string): Result<Trn, InvariantViolation> {
    const normalised = raw.replace(/[\s-]/g, '');

    if (normalised.length === 0) {
      return err(new InvariantViolation('A tax registration number is required'));
    }
    if (!/^\d+$/.test(normalised)) {
      return err(new InvariantViolation('A tax registration number is digits only'));
    }
    if (normalised.length !== DIGITS) {
      return err(
        new InvariantViolation(`A tax registration number has ${DIGITS} digits`, {
          received: normalised.length,
        }),
      );
    }
    return ok(new Trn(normalised));
  }

  /** Grouped in threes, the way it is printed on a certificate. */
  format(): string {
    return this.value.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  }

  equals(other: Trn): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
