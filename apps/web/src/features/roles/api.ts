import { type RolePermissions, rolePermissionsSchema } from '@amc/contracts';
import { put, request } from '../auth/api.js';

export async function rolePermissions(): Promise<RolePermissions> {
  return rolePermissionsSchema.parse(await request('/roles'));
}

/** The whole list for one role: what is ticked is what the role may do. */
export async function chooseRolePermissions(
  role: string,
  permissions: readonly string[],
): Promise<RolePermissions> {
  return rolePermissionsSchema.parse(
    await put(`/roles/${encodeURIComponent(role)}/permissions`, { permissions }),
  );
}
