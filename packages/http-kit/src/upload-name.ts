/**
 * The name a browser gave an uploaded file, as the person typed it.
 *
 * Multipart parsers hand a filename over as latin1 whatever the browser sent,
 * so "كشف الحساب.pdf" arrives as a string of Ã and Ø. Every Arabic file name
 * in this system would be stored as that, shown as that, and downloaded as
 * that. The bytes are right; they have only been read with the wrong table,
 * so reading them back with the right one restores them.
 *
 * Left alone when it is not what that mistake looks like: a name already
 * containing anything above U+00FF was decoded correctly by somebody, and a
 * name whose bytes are not valid UTF-8 was never UTF-8 to begin with. A plain
 * ASCII name comes out unchanged either way.
 */
export function decodeUploadName(raw: string): string {
  if ([...raw].some((character) => character.charCodeAt(0) > 0xff)) return raw;

  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
}
