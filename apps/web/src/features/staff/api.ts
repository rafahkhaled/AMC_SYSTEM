import { type StaffMember, staffDirectorySchema } from '@amc/contracts';
import { patch, request, send } from '../auth/api.js';

export async function staffDirectory(): Promise<StaffMember[]> {
  return staffDirectorySchema.parse(await request('/staff')).staff;
}

export async function addStaff(input: {
  email: string;
  displayName: string;
  password: string;
  roles: string[];
}): Promise<StaffMember[]> {
  return staffDirectorySchema.parse(await send('/staff', input)).staff;
}

export async function updateStaff(
  id: string,
  changes: {
    displayName?: string;
    roles?: string[];
    workingHours?: { startsAt: string; endsAt: string; days: number[] };
  },
): Promise<StaffMember[]> {
  return staffDirectorySchema.parse(await patch(`/staff/${encodeURIComponent(id)}`, changes)).staff;
}

/**
 * Suspending somebody, or putting them back.
 *
 * Not deletion: their id is on every hour they recorded and every audit row
 * they caused, and a practice that cannot say who did the work it invoiced
 * has a worse problem than a long staff list.
 */
export async function setStaffStatus(
  id: string,
  status: 'active' | 'suspended',
): Promise<StaffMember[]> {
  return staffDirectorySchema.parse(
    await send(`/staff/${encodeURIComponent(id)}/status`, { status }),
  ).staff;
}
