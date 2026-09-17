import { type LeadBoard, leadBoardSchema } from '@amc/contracts';
import { z } from 'zod';
import { request, send } from '../auth/api.js';

export async function leadBoard(): Promise<LeadBoard> {
  return leadBoardSchema.parse(await request('/leads'));
}

export async function captureLead(lead: {
  name: string;
  phone?: string;
  email?: string;
  source: string;
  sourceDetail?: string;
  requestedService?: string;
}): Promise<LeadBoard> {
  return leadBoardSchema.parse(await send('/leads', lead));
}

export async function moveLead(id: string, to: string, note?: string): Promise<LeadBoard> {
  return leadBoardSchema.parse(
    await send(`/leads/${encodeURIComponent(id)}/move`, { to, ...(note ? { note } : {}) }),
  );
}

export async function convertLead(
  id: string,
  legalName: string,
): Promise<{ clientId: string; board: LeadBoard }> {
  return z
    .object({ clientId: z.string(), board: leadBoardSchema })
    .parse(await send(`/leads/${encodeURIComponent(id)}/convert`, { legalName }));
}
