import { type ContactLogEntryView, contactLogEntrySchema } from '@amc/contracts';
import { z } from 'zod';
import { ApiError, request } from '../auth/api.js';

const listSchema = z.object({ entries: z.array(contactLogEntrySchema) });

export async function contactLog(clientId: string): Promise<ContactLogEntryView[]> {
  return listSchema.parse(await request(`/clients/${encodeURIComponent(clientId)}/contact-log`))
    .entries;
}

export interface ContactFields {
  readonly channel: string;
  readonly direction: string;
  readonly happenedAt: string;
  readonly summary: string;
  readonly taskId?: string;
}

/**
 * Multipart, because a WhatsApp thread is several images.
 *
 * No content type header: the browser writes its own with the boundary it
 * generated, and setting one here produces a body the server cannot parse.
 */
export async function recordContact(
  clientId: string,
  fields: ContactFields,
  files: readonly File[],
): Promise<ContactLogEntryView[]> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value) form.append(name, value);
  }
  for (const file of files) form.append('files', file);

  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/contact-log`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'CONTACT_FAILED',
      error?.message ?? 'That entry did not go through',
    );
  }
  return listSchema.parse(await response.json()).entries;
}

export async function attachmentLink(clientId: string, attachmentId: string): Promise<string> {
  const { url } = z
    .object({ url: z.string() })
    .parse(
      await request(
        `/clients/${encodeURIComponent(clientId)}/contact-log/attachments/${encodeURIComponent(attachmentId)}/link`,
      ),
    );
  return url;
}
