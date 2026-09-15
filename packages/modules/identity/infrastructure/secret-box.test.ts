import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const key = randomBytes(32).toString('base64');
  const box = new SecretBox(key);

  it('returns what it was given', () => {
    expect(box.open(box.seal('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different ciphertext every time, so equal secrets are not visibly equal', () => {
    expect(box.seal('same secret')).not.toBe(box.seal('same secret'));
  });

  it('keeps the plaintext out of the stored value', () => {
    expect(box.seal('JBSWY3DPEHPK3PXP')).not.toContain('JBSWY3DP');
  });

  it('refuses a tampered value rather than decrypting to something plausible', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    const flipped = Buffer.from(parts[2] ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    parts[2] = flipped.toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
  });

  it('refuses a value sealed with a different key', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => box.open(other.seal('secret'))).toThrow();
  });

  it('refuses anything that is not in its format', () => {
    for (const value of ['', 'plain text', 'v2.a.b.c', 'v1.only.two']) {
      expect(() => box.open(value)).toThrow();
    }
  });

  it('rejects a key of the wrong size, rather than silently weakening itself', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('compares a sealed value against a candidate without leaking through timing', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(box.holdsSame(sealed, 'JBSWY3DPEHPK3PXP')).toBe(true);
    expect(box.holdsSame(sealed, 'JBSWY3DPEHPK3PXQ')).toBe(false);
    expect(box.holdsSame('rubbish', 'anything')).toBe(false);
  });
});
