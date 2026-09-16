import {
  type ClientDetail,
  type ClientSummary,
  clientDetailSchema,
  clientListSchema,
} from '@amc/contracts';
import { request } from '../auth/api.js';

export async function listClients(): Promise<ClientSummary[]> {
  return clientListSchema.parse(await request('/clients')).clients;
}

export async function getClient(id: string): Promise<ClientDetail> {
  return clientDetailSchema.parse(await request(`/clients/${encodeURIComponent(id)}`));
}
