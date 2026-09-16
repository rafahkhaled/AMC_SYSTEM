import {
  type CredentialSummary,
  type RevealedCredential,
  credentialSummarySchema,
  revealedCredentialSchema,
} from '@amc/contracts';
import { z } from 'zod';
import { del, request, send } from '../auth/api.js';

const listSchema = z.object({ credentials: z.array(credentialSummarySchema) });

export async function listCredentials(clientId: string): Promise<CredentialSummary[]> {
  return listSchema.parse(await request(`/clients/${encodeURIComponent(clientId)}/credentials`))
    .credentials;
}

export async function storeCredential(
  clientId: string,
  entry: { kind: string; username: string; secret: string; note?: string },
): Promise<CredentialSummary[]> {
  return listSchema.parse(await send(`/clients/${encodeURIComponent(clientId)}/credentials`, entry))
    .credentials;
}

/**
 * A POST, not a GET, and it carries a reason.
 *
 * The reason goes into the audit log, and the method is a POST because this
 * changes something: it writes that row. A GET would also invite caching, a
 * browser history entry and a prefetch, none of which should happen to a
 * password.
 */
export async function revealCredential(
  clientId: string,
  credentialId: string,
  reason: string,
): Promise<RevealedCredential> {
  return revealedCredentialSchema.parse(
    await send(
      `/clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(credentialId)}/reveal`,
      { reason },
    ),
  );
}

export async function retireCredential(
  clientId: string,
  credentialId: string,
): Promise<CredentialSummary[]> {
  return listSchema.parse(
    await del(
      `/clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(credentialId)}`,
    ),
  ).credentials;
}
