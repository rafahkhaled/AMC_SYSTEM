import {
  type Classification,
  type ClassificationReport,
  type ClassifiedEntity,
  type Salesperson,
  type UpdateClassification,
  classificationReportSchema,
  classificationSchema,
  salespeopleSchema,
} from '@amc/contracts';
import { z } from 'zod';
import { patch, request, send } from '../auth/api.js';

export async function listSalespeople(): Promise<Salesperson[]> {
  return salespeopleSchema.parse(await request('/salespeople')).salespeople;
}

export async function addSalesperson(
  name: string,
): Promise<{ id: string; salespeople: Salesperson[] }> {
  return salespeopleSchema.extend({ id: z.string() }).parse(await send('/salespeople', { name }));
}

export async function classificationOf(
  entity: ClassifiedEntity,
  id: string,
): Promise<Classification> {
  return classificationSchema.parse(
    await request(`/classification/${entity}/${encodeURIComponent(id)}`),
  );
}

export async function changeClassification(
  entity: ClassifiedEntity,
  id: string,
  changes: UpdateClassification,
): Promise<Classification> {
  return classificationSchema.parse(
    await patch(`/classification/${entity}/${encodeURIComponent(id)}`, changes),
  );
}

export async function classificationReport(
  from: string,
  to: string,
): Promise<ClassificationReport> {
  return classificationReportSchema.parse(
    await request(`/classification/report?from=${from}&to=${to}`),
  );
}
