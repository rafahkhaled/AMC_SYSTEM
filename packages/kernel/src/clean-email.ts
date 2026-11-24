/**
 * An email address as typed or pasted, without what cannot be part of one.
 *
 * The firm copies addresses out of WhatsApp, which wraps English text in an
 * Arabic chat in invisible direction marks. They look like nothing, the
 * browser's email box refuses them, and an address that kept them could never
 * be written to. Removed here with any spaces, so "name@hotmail.com " and
 * "‎name@hotmail.com‎" are the address they look like.
 */
const INVISIBLE = /[ ؜᠎​-‏‪-‮⁠-⁩﻿\s]/g;

export function cleanEmail(typed: string | null | undefined): string | null {
  if (typed === null || typed === undefined) return null;
  const cleaned = typed.normalize('NFKC').replace(INVISIBLE, '');
  return cleaned === '' ? null : cleaned;
}
