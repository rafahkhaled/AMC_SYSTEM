import { type ReferenceList, type ReferenceOption, referenceOptionsSchema } from '@amc/contracts';
import { patch, request, send } from '../auth/api.js';

export async function referenceOptions(list?: ReferenceList): Promise<ReferenceOption[]> {
  return referenceOptionsSchema.parse(await request(list ? `/lists/${list}` : '/lists')).options;
}

export async function addOption(
  list: ReferenceList,
  option: { code: string; nameEn: string; nameAr: string; position?: number },
): Promise<ReferenceOption[]> {
  return referenceOptionsSchema.parse(await send(`/lists/${list}`, option)).options;
}

export async function updateOption(
  list: ReferenceList,
  code: string,
  changes: { nameEn?: string; nameAr?: string; position?: number; retired?: boolean },
): Promise<ReferenceOption[]> {
  return referenceOptionsSchema.parse(
    await patch(`/lists/${list}/${encodeURIComponent(code)}`, changes),
  ).options;
}
