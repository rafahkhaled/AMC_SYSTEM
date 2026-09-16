import type { ContactFileStore, DocumentFileStore } from '@amc/clients';
import { Conflict, type Result, err, ok } from '@amc/kernel';
import {
  type FileStorage,
  clientDocumentKey,
  contentTypeFor,
  extensionOf,
  storageKey,
} from '@amc/storage';

/** How long a download link lives. Long enough to click, short enough to leak safely. */
const LINK_SECONDS = 5 * 60;

/**
 * Puts an uploaded document where documents live.
 *
 * The key is derived from ids this system owns, never from the upload. The
 * extension is read from the filename only to choose a content type, and only
 * from an allowlist — a name the other end chose is not a path, and the one
 * place that could turn it into one is here.
 */
export function documentFileStore(storage: FileStorage): DocumentFileStore {
  return {
    async put({
      clientId,
      documentId,
      filename,
      contentType,
      body,
    }): Promise<Result<{ storageKey: string; checksum: string }, Conflict>> {
      const extension = extensionOf(filename);
      const accepted = contentTypeFor(extension);
      if (!accepted) {
        return err(new Conflict('This system keeps PDFs and scans; that is neither', { filename }));
      }

      /*
       * The browser's content type is a hint, not evidence. The extension
       * decides, because that is what the allowlist is written in terms of
       * and what the stored object will be served as.
       */
      if (contentType && contentType !== accepted) {
        // Not a refusal: browsers disagree about heic and tiff in particular,
        // and the file is stored under the type its extension implies either way.
      }

      const key = clientDocumentKey({ clientId, documentId, extension });
      if (!key.ok) return err(new Conflict(key.error.message));

      const stored = await storage.put(key.value, body, {
        contentType: accepted,
        originalName: filename,
        metadata: { clientId, documentId },
      });
      return ok({ storageKey: stored.key, checksum: stored.checksum });
    },

    async linkTo(storageKey, downloadName) {
      return storage.presignGet(storageKey, {
        expiresInSeconds: LINK_SECONDS,
        ...(downloadName ? { downloadName } : {}),
      });
    },
  };
}

/**
 * Where a screenshot of a conversation goes.
 *
 * Under the client, beside their documents but not among them: a WhatsApp
 * screenshot is evidence that somebody was asked, not a trade licence, and a
 * task's document checklist must never be able to pick one up.
 */
export function contactFileStore(storage: FileStorage): ContactFileStore {
  return {
    async put({ clientId, entryId, attachmentId, filename, body }) {
      const extension = extensionOf(filename);
      const accepted = contentTypeFor(extension);
      if (!accepted) {
        return err(new Conflict('A screenshot should be an image or a PDF', { filename }));
      }

      const key = storageKey([
        'clients',
        clientId,
        'contact-log',
        entryId,
        `${attachmentId}.${extension}`,
      ]);
      if (!key.ok) return err(new Conflict(key.error.message));

      const stored = await storage.put(key.value, body, {
        contentType: accepted,
        originalName: filename,
        metadata: { clientId, entryId },
      });
      return ok({
        storageKey: stored.key,
        checksum: stored.checksum,
        sizeBytes: stored.size,
      });
    },

    async linkTo(key, downloadName) {
      return storage.presignGet(key, {
        expiresInSeconds: LINK_SECONDS,
        ...(downloadName ? { downloadName } : {}),
      });
    },
  };
}
