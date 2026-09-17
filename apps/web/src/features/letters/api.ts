import {
  type Letter,
  type LetterTemplate,
  letterSchema,
  letterTemplateSchema,
} from '@amc/contracts';
import { z } from 'zod';
import { request, send } from '../auth/api.js';

export async function letterTemplates(): Promise<LetterTemplate[]> {
  return z
    .object({ templates: z.array(letterTemplateSchema) })
    .parse(await request('/letter-templates')).templates;
}

export async function lettersFor(clientId: string): Promise<Letter[]> {
  return z
    .object({ letters: z.array(letterSchema) })
    .parse(await request(`/clients/${encodeURIComponent(clientId)}/letters`)).letters;
}

export async function generateLetter(
  clientId: string,
  templateCode: string,
  language: 'en' | 'ar',
): Promise<Letter> {
  return letterSchema.parse(
    await send(`/clients/${encodeURIComponent(clientId)}/letters`, { templateCode, language }),
  );
}
