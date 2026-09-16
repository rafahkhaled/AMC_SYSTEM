import { type DocumentSummary, documentSummarySchema } from '@amc/contracts';
import { z } from 'zod';
import { ApiError, request } from '../auth/api.js';

const uploadResultSchema = z.object({
  documentId: z.string(),
  documents: z.array(documentSummarySchema),
});

export interface UploadFields {
  readonly type: string;
  readonly label?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
}

/**
 * Sends the file as multipart, which is what a browser does natively.
 *
 * The content type header is deliberately not set: the browser has to write
 * its own, with the boundary it generated, and setting one here silently
 * produces a body the server cannot parse.
 */
export async function uploadDocument(
  clientId: string,
  file: File,
  fields: UploadFields,
): Promise<{ documentId: string; documents: DocumentSummary[] }> {
  const form = new FormData();
  form.append('file', file);
  for (const [name, value] of Object.entries(fields)) {
    if (value) form.append(name, value);
  }

  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/documents`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = (
      body as { error?: { message?: string; code?: string; requestId?: string } } | null
    )?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UPLOAD_FAILED',
      error?.message ?? 'That upload did not go through',
      error?.requestId,
    );
  }
  return uploadResultSchema.parse(await response.json());
}

/** Where to fetch a document from: a link that works for a few minutes. */
export async function documentLink(id: string): Promise<string> {
  const { url } = z
    .object({ url: z.string() })
    .parse(await request(`/documents/${encodeURIComponent(id)}/link`));
  return url;
}
