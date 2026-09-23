import { type StaffMember, staffDirectorySchema } from '@amc/contracts';
import { request } from '../auth/api.js';

export async function staffDirectory(): Promise<StaffMember[]> {
  return staffDirectorySchema.parse(await request('/staff')).staff;
}
