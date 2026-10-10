import {
  type ClientFileView,
  type ClientFilesUploaded,
  clientFilesSchema,
  clientFilesUploadedSchema,
} from '@amc/contracts';
import { z } from 'zod';
import { ApiError, del, request } from '../auth/api.js';

export async function clientFiles(clientId: string): Promise<ClientFileView[]> {
  return clientFilesSchema.parse(await request(`/clients/${encodeURIComponent(clientId)}/files`))
    .files;
}

/**
 * Sends the files as multipart, one request however many there are.
 *
 * The content type header is deliberately not set: the browser has to write
 * its own, with the boundary it generated.
 */
export async function uploadClientFiles(
  clientId: string,
  files: readonly File[],
): Promise<ClientFilesUploaded> {
  const form = new FormData();
  for (const file of files) form.append('files', file);

  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/files`, {
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
      // A file over the limit is refused by the server before the app sees it,
      // with a status and no useful body; say what that means.
      response.status === 413
        ? 'That file is too large. The limit is 25 MB.'
        : (error?.message ?? 'That upload did not go through'),
      error?.requestId,
    );
  }
  return clientFilesUploadedSchema.parse(await response.json());
}

export async function clientFileLink(id: string): Promise<string> {
  const { url } = z
    .object({ url: z.string() })
    .parse(await request(`/client-files/${encodeURIComponent(id)}/link`));
  return url;
}

export async function removeClientFile(id: string): Promise<void> {
  await del(`/client-files/${encodeURIComponent(id)}`);
}
