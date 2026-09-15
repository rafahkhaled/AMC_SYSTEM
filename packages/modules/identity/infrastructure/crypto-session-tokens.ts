import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SessionTokenService } from '../application/ports.js';

/**
 * Session secrets are 32 random bytes, so there is nothing to guess and nothing
 * to derive. Because the input already carries full entropy, a single SHA-256
 * is the right way to store it: argon2 exists to slow down guessing at human
 * passwords, and there is no guessing to slow down here.
 *
 * Only the hash is stored, so a leaked database backup hands over no live
 * sessions. Comparison is constant time, so the server's response time reveals
 * nothing about how much of a guess was correct.
 */
const TOKEN_BYTES = 32;

export class CryptoSessionTokens implements SessionTokenService {
  issue(): { token: string; tokenHash: string } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  matches(tokenHash: string, token: string): boolean {
    const expected = Buffer.from(tokenHash, 'utf8');
    const actual = Buffer.from(this.hash(token), 'utf8');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}
