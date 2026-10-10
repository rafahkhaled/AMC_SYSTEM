import {
  type CreateServiceRequest,
  type ServiceView,
  type UpdateServiceRequest,
  serviceViewSchema,
  servicesSchema,
} from '@amc/contracts';
import { patch, request, send } from '../auth/api.js';

export async function listServices(): Promise<ServiceView[]> {
  return servicesSchema.parse(await request('/services')).services;
}

export async function addService(service: CreateServiceRequest): Promise<ServiceView> {
  return serviceViewSchema.parse(await send('/services', service));
}

export async function changeService(
  code: string,
  changes: UpdateServiceRequest,
): Promise<ServiceView> {
  return serviceViewSchema.parse(await patch(`/services/${encodeURIComponent(code)}`, changes));
}
