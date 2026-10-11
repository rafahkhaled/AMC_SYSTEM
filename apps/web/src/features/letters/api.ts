import {
  type CreateLetterTemplateRequest,
  type Letter,
  type LetterTemplate,
  type LetterTemplateDetail,
  type UpdateLetterTemplateRequest,
  letterSchema,
  letterTemplateDetailSchema,
  letterTemplateDetailsSchema,
  letterTemplateSchema,
} from '@amc/contracts';
import { z } from 'zod';
import { patch, request, send } from '../auth/api.js';

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
  /** Who it is addressed to, from the authority list. */
  authority?: string,
): Promise<Letter> {
  return letterSchema.parse(
    await send(`/clients/${encodeURIComponent(clientId)}/letters`, {
      templateCode,
      language,
      ...(authority ? { authority } : {}),
    }),
  );
}

/* ----------------------------------------------- maintaining the letters (item 6) */

export async function letterTemplateDetails(): Promise<LetterTemplateDetail[]> {
  return letterTemplateDetailsSchema.parse(await request('/letter-templates/all')).templates;
}

export async function addLetterTemplate(
  template: CreateLetterTemplateRequest,
): Promise<LetterTemplateDetail> {
  return letterTemplateDetailSchema.parse(await send('/letter-templates', template));
}

export async function changeLetterTemplate(
  code: string,
  changes: UpdateLetterTemplateRequest,
): Promise<LetterTemplateDetail> {
  return letterTemplateDetailSchema.parse(
    await patch(`/letter-templates/${encodeURIComponent(code)}`, changes),
  );
}
