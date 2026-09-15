import { describe, expect, it } from 'vitest';
import { decodeBase32, encodeBase32 } from './base32.js';
import { DEFAULT_TOTP, generateTotpSecret, hotp, totp, totpUri, verifyTotp } from './totp.js';

/**
 * The RFC publishes test vectors precisely so that an implementation can be
 * shown correct rather than assumed correct. These are those vectors.
 */
describe('base32, RFC 4648', () => {
  it('matches the published vectors', () => {
    const vectors: [string, string][] = [
      ['f', 'MY======'],
      ['fo', 'MZXQ===='],
      ['foo', 'MZXW6==='],
      ['foob', 'MZXW6YQ='],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI======'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(encodeBase32(new TextEncoder().encode(plain))).toBe(encoded.replace(/=/g, ''));
      expect(new TextDecoder().decode(decodeBase32(encoded))).toBe(plain);
    }
  });

  it('forgives the spacing and padding a person retypes from a screen', () => {
    expect(new TextDecoder().decode(decodeBase32('mzxw 6ytb oi=='))).toBe('foobar');
  });

  it('refuses characters that are not in the alphabet', () => {
    expect(() => decodeBase32('MZXW6YTB!')).toThrow();
  });
});

describe('HOTP, RFC 4226 appendix D', () => {
  it('matches all ten published vectors for the secret "12345678901234567890"', () => {
    const secret = new TextEncoder().encode('12345678901234567890');
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => {
      expect(hotp(secret, counter, { digits: 6, algorithm: 'sha1' })).toBe(code);
    });
  });
});

describe('TOTP, RFC 6238 appendix B', () => {
  // The RFC's SHA-1 vectors, which use the same twenty-byte seed.
  const secretBase32 = encodeBase32(new TextEncoder().encode('12345678901234567890'));
  const eightDigits = { ...DEFAULT_TOTP, digits: 8 };

  it('matches the published times and codes', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totp(secretBase32, seconds * 1000, eightDigits)).toBe(code);
    }
  });
});

describe('verifying a submitted code', () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 8, 15, 10, 0, 0);

  it('accepts the current code', () => {
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
  });

  it('forgives a phone clock that is half a minute out, in either direction', () => {
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(true);
  });

  it('refuses a code that is two periods stale', () => {
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
  });

  it('refuses a wrong code, a short code and an empty one', () => {
    expect(verifyTotp(secret, '000000', now)).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
    expect(verifyTotp(secret, '', now)).toBe(false);
  });

  it('ignores the spaces authenticator apps put in the middle', () => {
    const code = totp(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });

  it('produces a different code for a different secret at the same instant', () => {
    expect(totp(generateTotpSecret(), now)).not.toBe(totp(secret, now));
  });
});

describe('the enrolment URI', () => {
  it('carries everything an authenticator app needs', () => {
    const uri = totpUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      account: 'wael@activemanagement.ae',
      issuer: 'AMC',
    });
    expect(uri).toContain('otpauth://totp/AMC%3Awael%40activemanagement.ae');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=AMC');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
