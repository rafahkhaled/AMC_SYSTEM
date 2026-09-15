import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { KeyProvider } from './key-provider.js';

/**
 * Authenticated encryption for a secret at rest, under a key that is itself
 * encrypted.
 *
 * AES-256-GCM authenticates as well as encrypts, so a row that has been
 * tampered with refuses to decrypt rather than returning something plausible.
 * The stored form carries its version, so the scheme can change without every
 * row having to be rewritten on the same day.
 *
 *   v2.<key id>.<wrapped data key>.<iv>.<ciphertext>.<tag>
 */
const VERSION = 'v2';
const IV_BYTES = 12;

export class EnvelopeCipher {
  constructor(private readonly keys: KeyProvider) {}

  async seal(plaintext: string): Promise<string> {
    const dataKey = await this.keys.generate();
    const iv = randomBytes(IV_BYTES);

    try {
      const cipher = createCipheriv('aes-256-gcm', dataKey.plaintext, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        VERSION,
        this.keys.keyId,
        dataKey.encrypted.toString('base64url'),
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
      ].join('.');
    } finally {
      // The data key is used once. Clearing it shortens the window in which a
      // core dump or a swapped page would hand it over.
      dataKey.plaintext.fill(0);
    }
  }

  async open(sealed: string): Promise<string> {
    const parts = sealed.split('.');
    if (parts.length !== 6 || parts[0] !== VERSION) {
      throw new Error('That value was not sealed by this system');
    }
    const [, , wrappedKey, iv, ciphertext, tag] = parts;
    if (!wrappedKey || !iv || !ciphertext || !tag) {
      throw new Error('That sealed value is incomplete');
    }

    const dataKey = await this.keys.decrypt(Buffer.from(wrappedKey, 'base64url'));
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } finally {
      dataKey.fill(0);
    }
  }

  /** Which master key sealed this, so rotation can find what still needs it. */
  static keyIdOf(sealed: string): string | null {
    const parts = sealed.split('.');
    return parts.length === 6 && parts[0] === VERSION ? (parts[1] ?? null) : null;
  }

  async holdsSame(sealed: string, candidate: string): Promise<boolean> {
    try {
      const opened = Buffer.from(await this.open(sealed), 'utf8');
      const other = Buffer.from(candidate, 'utf8');
      if (opened.length !== other.length) return false;
      return timingSafeEqual(opened, other);
    } catch {
      return false;
    }
  }
}
