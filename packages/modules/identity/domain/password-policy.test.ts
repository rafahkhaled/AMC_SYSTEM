import { describe, expect, it } from 'vitest';
import { MINIMUM_PASSWORD_LENGTH, checkPassword } from './password-policy.js';

describe('password policy', () => {
  it('requires real length, because length beats symbol puzzles', () => {
    expect(checkPassword('short').ok).toBe(false);
    expect(checkPassword('a'.repeat(MINIMUM_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it('accepts a passphrase without demanding punctuation', () => {
    expect(checkPassword('correct horse battery staple').ok).toBe(true);
  });

  it('turns away the passwords people type when in a hurry', () => {
    expect(checkPassword('password123').ok).toBe(false);
    expect(checkPassword('PASSWORD123').ok).toBe(false);
  });

  it('refuses a password built from the person own address', () => {
    expect(checkPassword('waelwaelwael', { email: 'wael@activemanagement.ae' }).ok).toBe(false);
  });

  it('has an upper bound, so a hash is never asked to chew a megabyte', () => {
    expect(checkPassword('x'.repeat(300)).ok).toBe(false);
  });
});
