import { type Algorithm, hash, parseOptions, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../application/ports.js';

/**
 * Argon2id, with the settings OWASP currently gives as a minimum: 19 MiB of
 * memory, two passes, one lane. Memory cost is what makes a graphics card an
 * inefficient way to attack these, which is the entire point of choosing
 * argon2id over anything faster.
 *
 * The cost is recorded inside every hash, so raising these numbers later does
 * not invalidate existing passwords. needsRehash spots the older ones and
 * sign-in upgrades them while the plaintext is briefly in hand, so nobody is
 * ever asked to change a password for our convenience.
 */
/**
 * The library declares Algorithm as an ambient const enum, which cannot be read
 * as a value under verbatimModuleSyntax. Argon2id is 2 in the standard
 * ordering, and the assertion below keeps the type honest.
 */
const ARGON2ID = 2 as Algorithm;

const PARAMETERS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, PARAMETERS);
  }

  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, PARAMETERS);
    } catch {
      // A malformed hash is simply a failed sign-in as far as the caller is
      // concerned. It must never surface as a different kind of error, because
      // that difference would be visible from outside.
      return false;
    }
  }

  /**
   * This library gives no needsRehash, so read the parameters recorded in the
   * hash and compare. Weaker on any axis means it should be renewed; stronger
   * is left alone, since downgrading a password nobody asked us to touch would
   * be worse than leaving it.
   */
  needsRehash(storedHash: string): boolean {
    try {
      const stored = parseOptions(storedHash);
      if (!stored) return true;
      return (
        (stored.memoryCost ?? 0) < PARAMETERS.memoryCost ||
        (stored.timeCost ?? 0) < PARAMETERS.timeCost ||
        (stored.algorithm ?? ARGON2ID) !== ARGON2ID
      );
    } catch {
      return true;
    }
  }
}
