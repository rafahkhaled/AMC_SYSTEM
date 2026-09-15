import { type Result, ValidationFailed, err, ok } from '@amc/kernel';

/**
 * What counts as an acceptable password.
 *
 * Length does more for strength than character classes do, so the rule is a
 * long minimum rather than a puzzle of symbols that pushes people towards
 * writing it on a note. The obvious-password list is short on purpose: it
 * catches the handful that get typed when someone is in a hurry.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 256;

const OBVIOUS = new Set([
  'password',
  'password123',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'administrator',
  'amcamcamcamc',
]);

export function checkPassword(
  password: string,
  context: { email?: string } = {},
): Result<string, ValidationFailed> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return err(
      new ValidationFailed(`A password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`, {
        minimum: MINIMUM_PASSWORD_LENGTH,
      }),
    );
  }
  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    return err(new ValidationFailed('That password is too long'));
  }
  if (OBVIOUS.has(password.toLowerCase())) {
    return err(new ValidationFailed('That password is too easy to guess'));
  }
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return err(new ValidationFailed('A password must not contain your email address'));
  }
  return ok(password);
}
