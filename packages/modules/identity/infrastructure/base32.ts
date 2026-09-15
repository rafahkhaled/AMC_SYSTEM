/**
 * Base32 as RFC 4648 defines it, which is how every authenticator app expects
 * a shared secret to be written. Implemented here rather than pulled in,
 * because it is twenty lines and a dependency in the authentication path is a
 * dependency that can be compromised.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string): Uint8Array {
  // Padding and spacing are stripped: people retype these from a screen, and
  // "JBSW Y3DP" should mean what it looks like it means.
  const cleaned = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const character of cleaned) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`Not valid base32: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}
