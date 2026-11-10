import {
  type ChangeClientDetails,
  type ClientDetail,
  type ClientSummary,
  type OnboardClient,
  clientDetailSchema,
  clientListSchema,
} from '@amc/contracts';
import { del, patch, request, send } from '../auth/api.js';

export async function listClients(): Promise<ClientSummary[]> {
  return clientListSchema.parse(await request('/clients')).clients;
}

export async function getClient(id: string): Promise<ClientDetail> {
  return clientDetailSchema.parse(await request(`/clients/${encodeURIComponent(id)}`));
}

/** Only the fields named are changed; a field sent as null is cleared. */
export async function changeClientDetails(
  id: string,
  body: ChangeClientDetails,
): Promise<ClientDetail> {
  return clientDetailSchema.parse(await patch(`/clients/${encodeURIComponent(id)}/details`, body));
}

/** Adding a client directly, without an enquiry first. */
export async function onboardClient(body: OnboardClient): Promise<ClientDetail> {
  return clientDetailSchema.parse(await send('/clients', body));
}

/** Deletes a client and everything filed under them. Refused once they have been billed. */
export async function removeClient(id: string): Promise<void> {
  await del(`/clients/${encodeURIComponent(id)}`);
}
