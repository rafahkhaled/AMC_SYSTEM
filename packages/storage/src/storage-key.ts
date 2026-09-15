import { InvariantViolation, type Result, err, ok } from '@amc/kernel';

/**
 * Keys are derived here and never taken from a client.
 *
 * A filename that arrives with an upload is a value the person on the other
 * end chose, and "../../etc/passwd" is a filename. The original is kept as
 * metadata for display; the key it is stored under is ours.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type StorageKey = string & { readonly __brand: 'StorageKey' };

export function storageKey(segments: readonly string[]): Result<StorageKey, InvariantViolation> {
  if (segments.length === 0)
    return err(new InvariantViolation('A storage key needs at least one part'));

  for (const segment of segments) {
    if (!SAFE_SEGMENT.test(segment)) {
      return err(new InvariantViolation('That is not a usable name for stored data', { segment }));
    }
    if (segment === '.' || segment === '..') {
      return err(new InvariantViolation('A storage key cannot climb directories', { segment }));
    }
  }
  return ok(segments.join('/') as StorageKey);
}

/** Where a client's document lives: predictable, unguessable, and theirs. */
export function clientDocumentKey(params: {
  clientId: string;
  documentId: string;
  extension: string;
}): Result<StorageKey, InvariantViolation> {
  const extension = params.extension.replace(/^\./, '').toLowerCase();
  return storageKey(['clients', params.clientId, 'documents', `${params.documentId}.${extension}`]);
}

/** Where an uploaded supplier invoice lives, inside the batch it arrived with. */
export function invoiceBatchKey(params: {
  clientId: string;
  batchId: string;
  itemId: string;
  extension: string;
}): Result<StorageKey, InvariantViolation> {
  const extension = params.extension.replace(/^\./, '').toLowerCase();
  return storageKey([
    'clients',
    params.clientId,
    'batches',
    params.batchId,
    `${params.itemId}.${extension}`,
  ]);
}

/**
 * What may be stored at all.
 *
 * An allowlist, not a blocklist. The system takes supplier invoices and client
 * documents, which are PDFs, scans and photographs; anything else arriving is
 * either a mistake or an attempt, and neither should be kept.
 */
export const ACCEPTED_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export function contentTypeFor(extension: string): string | null {
  return ACCEPTED_TYPES[extension.replace(/^\./, '').toLowerCase()] ?? null;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}
