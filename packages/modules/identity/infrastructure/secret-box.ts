import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticated encryption for a short secret at rest.
 *
 * A two-factor secret in a plain column defeats the point of two-factor
 * authentication: anyone who reads a database backup can generate valid codes
 * for every account in it. So it is encrypted, with AES-256-GCM, which also
 * authenticates the ciphertext and therefore refuses to decrypt a row that has
 * been tampered with rather than returning something plausible.
 *
 * The key comes from configuration today. P0-14 replaces that with envelope
 * encryption under a KMS master key and widens this to the EmaraTax vault
 * (FR-05); the stored format already carries a version so that the change can
 * be made without rewriting every row at once.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `The secret key must be ${KEY_BYTES} bytes, base64 encoded. Generate one with: openssl rand -base64 32`,
      );
    }
    this.key = key;
  }

  seal(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  open(sealed: string): string {
    const [version, iv, ciphertext, tag] = sealed.split('.');
    if (version !== VERSION || !iv || !ciphertext || !tag) {
      throw new Error('That value was not sealed by this system');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    // Throws when the tag does not match, which is the behaviour we want:
    // a tampered row must fail loudly, never decrypt to something plausible.
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when two sealed values hold the same secret. */
  holdsSame(sealed: string, plaintext: string): boolean {
    try {
      const opened = Buffer.from(this.open(sealed), 'utf8');
      const candidate = Buffer.from(plaintext, 'utf8');
      if (opened.length !== candidate.length) return false;
      return timingSafeEqual(opened, candidate);
    } catch {
      return false;
    }
  }
}
