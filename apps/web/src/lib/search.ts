/**
 * Whether what somebody searched for is in a piece of text.
 *
 * Search worked when typed and not when pasted: text copied from WhatsApp, a
 * PDF or a certificate carries invisible direction marks, non-breaking
 * spaces, "L.L.C" for "LLC", Arabic-Indic digits and the several ways of
 * writing an alef. Both sides are reduced to letters and digits in one form
 * before they are compared, so what was pasted finds what was typed.
 */
export function matches(text: string | null | undefined, query: string): boolean {
  const needle = plain(query);
  if (needle === '') return true;
  return plain(text ?? '').includes(needle);
}

/** Letters and digits only, one way of writing each. Exported for tests. */
export function plain(value: string): string {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      // Arabic-Indic and Persian digits as 0-9.
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      // The alef with hamza or madda as a bare alef; ta marbuta and alef maqsura
      // as the letters they are usually typed as; tatweel and vowel marks gone.
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[ـً-ٟ]/g, '')
      // Everything that is not a letter or a digit: spaces of every kind,
      // punctuation, and the invisible marks copied text brings with it.
      .replace(/[^\p{L}\p{N}]/gu, '')
  );
}
