/**
 * Phone numbers, in one form.
 *
 * A number reaches this system written five ways. A client writes it
 * `050 123 4567` on a form, an accountant pastes `+971 50 123 4567` from a
 * signature, a spreadsheet import carries `00971501234567`, and WhatsApp hands
 * over `971501234567` with no plus at all. They are the same phone, and the
 * only question that matters — *whose number is this?* — cannot be answered by
 * comparing those strings.
 *
 * So every number is reduced to E.164 before it is compared or stored for
 * comparison. The original is kept as the person typed it, because that is
 * what they will recognise on a screen; the reduced form is what is indexed.
 *
 * This lives in the kernel rather than in a module because the reduction is
 * also done in SQL, by `e164` in migration 0023, so that a generated column can
 * be indexed. Two implementations of one rule is a drift waiting to happen, and
 * `phone-number.agreement.test.ts` runs the same table of inputs through both
 * and fails if they ever disagree.
 */

/** The country this practice is in. Everything local is assumed to be here. */
const UAE = '971';

/**
 * Mobile prefixes issued in the UAE, without the leading zero.
 *
 * Checked rather than assumed, because `04 123 4567` is a Dubai landline and
 * treating it as a mobile would put it in the same shape as a mobile and let
 * it match one. Landlines are still reduced — they are still phone numbers —
 * they are simply not mistaken for something they are not.
 */
const AE_MOBILE_PREFIXES = ['50', '52', '54', '55', '56', '58'] as const;

/** Landline area codes, again without the leading zero. */
const AE_LANDLINE_PREFIXES = ['2', '3', '4', '6', '7', '9'] as const;

export type PhoneKind = 'mobile' | 'landline' | 'foreign';

/**
 * Reduces a number to E.164, or returns null when it cannot be read.
 *
 * Null rather than a guess. A number this cannot parse belongs to nobody, and
 * an inbound WhatsApp message from an unrecognised number is handled — it
 * becomes a conversation with no client attached. Guessing would attach it to
 * the wrong one, which is worse than attaching it to none.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Arabic-Indic digits, which is how a number arrives when it was typed on an
  // Arabic keyboard. Without this the whole string looks like punctuation.
  const latinised = raw.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });

  const hadPlus = latinised.trimStart().startsWith('+');
  let digits = latinised.replace(/\D/g, '');
  if (digits.length === 0) return null;

  // 00 is how the rest of the world writes +. Both mean "international next".
  if (!hadPlus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!hadPlus && !digits.startsWith(UAE)) {
    // No international marker of any kind, so it is a local number: either
    // with the trunk zero, 050..., or written bare on a business card.
    const national = digits.startsWith('0') ? digits.slice(1) : digits;
    return isNationalAE(national) ? `+${UAE}${national}` : null;
  }

  /*
   * An international number, however it was marked. A UAE one is held to the
   * same national rules as a locally written one — the plus is a statement
   * about format, not a promise that the digits after it are a real number,
   * and trusting it let `+9715012345678` through with a digit too many.
   */
  if (digits.startsWith(UAE)) {
    const national = digits.slice(UAE.length);
    return isNationalAE(national) ? `+${UAE}${national}` : null;
  }

  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** Whether these digits are a UAE number with the trunk zero already removed. */
function isNationalAE(national: string): boolean {
  if (AE_MOBILE_PREFIXES.some((prefix) => national.startsWith(prefix))) {
    return national.length === 9;
  }
  if (AE_LANDLINE_PREFIXES.some((prefix) => national.startsWith(prefix))) {
    return national.length === 8;
  }
  return false;
}

/**
 * What kind of number this is, given its E.164 form.
 *
 * Used to decide whether sending a WhatsApp message to it is even plausible.
 * A landline can hold a WhatsApp Business account, so this does not forbid
 * anything; it lets a screen say "this is a landline" before somebody wonders
 * why there was no reply.
 */
export function kindOf(e164: string): PhoneKind {
  if (!e164.startsWith(`+${UAE}`)) return 'foreign';
  const national = e164.slice(UAE.length + 1);
  if (AE_MOBILE_PREFIXES.some((prefix) => national.startsWith(prefix))) return 'mobile';
  if (AE_LANDLINE_PREFIXES.some((prefix) => national.startsWith(prefix))) return 'landline';
  return 'foreign';
}

/**
 * How a number is shown to a person: `+971 50 123 4567`.
 *
 * Grouped the way it is read aloud here. A foreign number is left in one piece
 * rather than grouped by a rule that happens to be the UAE's.
 */
export function formatPhone(e164: string): string {
  if (kindOf(e164) === 'foreign') return e164;
  const national = e164.slice(UAE.length + 1);
  const groups =
    national.length === 9
      ? [national.slice(0, 2), national.slice(2, 5), national.slice(5)]
      : [national.slice(0, 1), national.slice(1, 4), national.slice(4)];
  return `+${UAE} ${groups.join(' ')}`;
}

/**
 * The number Meta just gave us, as E.164.
 *
 * Separate from `toE164` because the same digits mean different things
 * depending on who wrote them. A person typing `971501234567` into a form might
 * be writing the number the local way and might be writing it the
 * international way, and `toE164` has to decide. Meta has no such ambiguity: a
 * `wa_id` is always E.164 with the plus stripped, so putting the plus back is
 * the whole conversion.
 *
 * Reading Meta's numbers with `toE164` instead looks like it works, because
 * every UAE number comes out right. It fails on exactly the numbers nobody
 * tests with: `966501234567` does not start with 971, so it is read as a local
 * number, fails the national rules, and reduces to nothing — and a Saudi
 * client's messages arrive attached to no client at all.
 */
export function fromWhatsAppAddress(waId: string): string | null {
  const digits = waId.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return toE164(`+${digits}`);
}

/**
 * The form WhatsApp's API uses: E.164 with the plus removed.
 *
 * Meta accepts the plus on the way in and never sends it on the way out, which
 * is the kind of asymmetry that produces a lookup miss at three in the morning.
 */
export function toWhatsAppAddress(e164: string): string {
  return e164.startsWith('+') ? e164.slice(1) : e164;
}
