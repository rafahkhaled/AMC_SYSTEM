import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  fromWhatsAppAddress,
  kindOf,
  toE164,
  toWhatsAppAddress,
} from './phone-number.js';

/**
 * Every shape a number actually arrives in, and what it reduces to.
 *
 * The SQL half of this rule is checked separately, in
 * `packages/database/src/phone-agreement.test.ts`, which builds its inputs
 * from their parts rather than reading this list — a shared list only ever
 * covers what somebody thought of.
 */
const KNOWN_FORMS: readonly (readonly [string, string | null])[] = [
  // The same Dubai mobile, written the ways it actually arrives.
  ['+971501234567', '+971501234567'],
  ['+971 50 123 4567', '+971501234567'],
  ['00971501234567', '+971501234567'],
  ['971501234567', '+971501234567'],
  ['0501234567', '+971501234567'],
  ['050 123 4567', '+971501234567'],
  ['050-123-4567', '+971501234567'],
  ['(050) 123 4567', '+971501234567'],
  ['501234567', '+971501234567'],
  ['٠٥٠١٢٣٤٥٦٧', '+971501234567'],

  // Every UAE mobile prefix in service.
  ['0521234567', '+971521234567'],
  ['0541234567', '+971541234567'],
  ['0551234567', '+971551234567'],
  ['0561234567', '+971561234567'],
  ['0581234567', '+971581234567'],

  // Landlines, which are eight digits after the area code, not nine.
  ['042345678', '+97142345678'],
  ['04 234 5678', '+97142345678'],
  ['+971 4 234 5678', '+97142345678'],
  ['026543210', '+97126543210'],

  // Foreign numbers pass through, because clients have owners abroad.
  ['+966501234567', '+966501234567'],
  ['+44 20 7946 0958', '+442079460958'],
  ['+1 (415) 555-0123', '+14155550123'],

  // Nothing here is a phone number.
  ['', null],
  ['   ', null],
  ['not a number', null],
  ['12345', null],
  ['05012345', null],
  ['05012345678', null],
  ['0512345678', null],
  ['0112345678', null],
  ['+9715012345678', null],
];

describe('toE164', () => {
  for (const [input, expected] of KNOWN_FORMS) {
    it(`reads ${JSON.stringify(input)} as ${expected ?? 'not a number'}`, () => {
      expect(toE164(input)).toBe(expected);
    });
  }

  it('reads nothing out of nothing', () => {
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });

  it('is idempotent, so a number can be reduced twice without harm', () => {
    for (const [input] of KNOWN_FORMS) {
      const once = toE164(input);
      if (once) expect(toE164(once)).toBe(once);
    }
  });

  it('refuses a nine-digit mobile that is one digit short', () => {
    // 05012345 looks like a mobile and is not one. Accepting it would let two
    // different people share a normalised number.
    expect(toE164('05012345')).toBeNull();
  });

  it('does not mistake a landline length for a mobile', () => {
    // Eight digits after the trunk zero starting 5 is neither shape.
    expect(toE164('05012345')).toBeNull();
    expect(toE164('042345678')).toBe('+97142345678');
  });
});

describe('kindOf', () => {
  it('names a mobile', () => {
    expect(kindOf('+971501234567')).toBe('mobile');
    expect(kindOf('+971581234567')).toBe('mobile');
  });

  it('names a landline', () => {
    expect(kindOf('+97142345678')).toBe('landline');
  });

  it('calls anything outside the country foreign', () => {
    expect(kindOf('+442079460958')).toBe('foreign');
    expect(kindOf('+966501234567')).toBe('foreign');
  });
});

describe('formatPhone', () => {
  it('groups a mobile the way it is read aloud', () => {
    expect(formatPhone('+971501234567')).toBe('+971 50 123 4567');
  });

  it('groups a landline by its area code', () => {
    expect(formatPhone('+97142345678')).toBe('+971 4 234 5678');
  });

  it('leaves a foreign number alone rather than grouping it by our rules', () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});

describe('fromWhatsAppAddress', () => {
  it('puts the plus back on a UAE number', () => {
    expect(fromWhatsAppAddress('971501234567')).toBe('+971501234567');
  });

  it('reads a foreign number, which toE164 alone cannot', () => {
    // This is the whole reason the function exists. Read as something a person
    // typed, '966501234567' is a local number that fails the national rules
    // and reduces to nothing, and that client's messages arrive orphaned.
    expect(fromWhatsAppAddress('966501234567')).toBe('+966501234567');
    expect(fromWhatsAppAddress('442079460958')).toBe('+442079460958');
    expect(fromWhatsAppAddress('14155550123')).toBe('+14155550123');
  });

  it('still holds a UAE number to the national rules', () => {
    expect(fromWhatsAppAddress('9715012345678')).toBeNull();
  });

  it('refuses something that is not a number', () => {
    expect(fromWhatsAppAddress('')).toBeNull();
    expect(fromWhatsAppAddress('12345')).toBeNull();
    expect(fromWhatsAppAddress('1234567890123456')).toBeNull();
  });

  it('is the inverse of toWhatsAppAddress', () => {
    for (const e164 of ['+971501234567', '+97142345678', '+966501234567', '+442079460958']) {
      expect(fromWhatsAppAddress(toWhatsAppAddress(e164))).toBe(e164);
    }
  });
});

describe('toWhatsAppAddress', () => {
  it('drops the plus, which is the only form Meta returns', () => {
    expect(toWhatsAppAddress('+971501234567')).toBe('971501234567');
  });

  it('leaves an address that already has no plus alone', () => {
    expect(toWhatsAppAddress('971501234567')).toBe('971501234567');
  });
});
