import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decodeBase32, encodeBase32 } from './base32.js';

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * Written out rather than taken from a package, for two reasons. The algorithm
 * is small and completely specified, and the RFC publishes test vectors, so
 * correctness here is demonstrated rather than assumed. And an authentication
 * path is exactly where an unnecessary dependency is worth avoiding.
 */
export interface TotpOptions {
  /** Seconds per code. Thirty is what every authenticator app assumes. */
  readonly period: number;
  readonly digits: number;
  readonly algorithm: 'sha1' | 'sha256' | 'sha512';
  /**
   * How many periods either side are accepted, to allow for a phone whose
   * clock has drifted. One period each way is the usual compromise: it
   * forgives thirty seconds of drift without tripling the guessing surface.
   */
  readonly window: number;
}

export const DEFAULT_TOTP: TotpOptions = {
  period: 30,
  digits: 6,
  // sha1 not for want of better, but because it is what authenticator apps
  // implement. HMAC-SHA1 is not affected by the collision attacks that retired
  // SHA-1 for signatures.
  algorithm: 'sha1',
  window: 1,
};

export function generateTotpSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

/** The code for one counter value. Exposed for the RFC test vectors. */
export function hotp(
  secret: Uint8Array,
  counter: number,
  options: Pick<TotpOptions, 'digits' | 'algorithm'>,
): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(options.algorithm, Buffer.from(secret)).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binary % 10 ** options.digits).toString().padStart(options.digits, '0');
}

export function totp(
  secretBase32: string,
  atMilliseconds: number,
  options: TotpOptions = DEFAULT_TOTP,
): string {
  const counter = Math.floor(atMilliseconds / 1000 / options.period);
  return hotp(decodeBase32(secretBase32), counter, options);
}

/**
 * Whether a code is acceptable now. Every candidate is compared in constant
 * time and all of them are compared, so neither the response time nor an early
 * return says which period matched.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMilliseconds: number,
  options: TotpOptions = DEFAULT_TOTP,
): boolean {
  const submitted = code.replace(/\s/g, '');
  if (submitted.length !== options.digits) return false;

  const secret = decodeBase32(secretBase32);
  const counter = Math.floor(atMilliseconds / 1000 / options.period);
  let matched = false;

  for (let drift = -options.window; drift <= options.window; drift += 1) {
    const expected = hotp(secret, counter + drift, options);
    if (constantTimeEquals(expected, submitted)) matched = true;
  }
  return matched;
}

function constantTimeEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The otpauth:// URI an authenticator app reads from a QR code. The issuer
 * appears twice by convention, so the account is labelled correctly in apps
 * that read only one of the two.
 */
export function totpUri(params: {
  secretBase32: string;
  account: string;
  issuer: string;
  options?: TotpOptions;
}): string {
  const options = params.options ?? DEFAULT_TOTP;
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: options.algorithm.toUpperCase(),
    digits: String(options.digits),
    period: String(options.period),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
