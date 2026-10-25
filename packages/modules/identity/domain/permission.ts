/**
 * Permissions, taken directly from the role table in SRS section 2.2.
 *
 * They are an explicit list rather than a database table because they change
 * only when the requirements change, and a compile error is a better way to
 * discover a missing case than a row someone forgot to insert.
 */
export const PERMISSIONS = [
  // Clients
  'clients.view.all',
  'clients.view.assigned',
  'clients.edit',
  'clients.rates.manage',
  'clients.vault.read',

  // Projects and time
  'projects.view.all',
  'projects.view.assigned',
  'projects.edit',
  'projects.assign',
  'time.record',
  'time.edit.any',

  // Billing
  'billing.view',
  'billing.approve',
  'billing.invoice.issue',
  'billing.entries.unlink',

  // AI invoice processing
  'invoices.upload',
  'invoices.correct',
  'invoices.approve.assigned',
  'invoices.approve.all',

  // Output and administration
  'export.excel',
  'export.all',
  'users.manage',
  'audit.read',

  // Client portal
  'portal.self.view',
  'portal.self.upload',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['manager', 'accountant', 'data_entry', 'client'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The matrix from SRS 2.2, read as: what may this role do?
 *
 * The distinction that matters most is `clients.view.all` against
 * `clients.view.assigned`. An accountant may only reach the clients assigned to
 * them, and that is enforced in the repositories, not merely hidden in the user
 * interface.
 */
const MATRIX: Readonly<Record<Role, readonly Permission[]>> = {
  manager: [
    'clients.view.all',
    'clients.edit',
    'clients.rates.manage',
    'clients.vault.read',
    'projects.view.all',
    'projects.edit',
    'projects.assign',
    'time.record',
    'time.edit.any',
    'billing.view',
    'billing.approve',
    'billing.invoice.issue',
    'billing.entries.unlink',
    'invoices.upload',
    'invoices.correct',
    'invoices.approve.all',
    'export.excel',
    'export.all',
    'users.manage',
    'audit.read',
  ],
  accountant: [
    'clients.view.assigned',
    'clients.vault.read',
    'projects.view.assigned',
    'projects.edit',
    'time.record',
    'billing.view',
    'invoices.upload',
    'invoices.correct',
    'invoices.approve.assigned',
    'export.excel',
  ],
  data_entry: ['projects.view.assigned', 'invoices.upload', 'invoices.correct'],
  client: ['portal.self.view', 'portal.self.upload'],
};

/** What every role may do. The defaults above, with the firm's own choices applied. */
export type RoleMatrix = Readonly<Record<Role, readonly Permission[]>>;
export const DEFAULT_MATRIX: RoleMatrix = MATRIX;

/**
 * The roles whose permissions the firm can change from Settings.
 *
 * Not the manager: a manager who could take `users.manage` away from managers
 * would lock the firm out of its own system with one click, and there would be
 * nobody left to undo it. Not the client either, whose two permissions are the
 * whole of what a client portal is.
 */
export const EDITABLE_ROLES: readonly Role[] = ['accountant', 'data_entry'];

/**
 * What can be granted or taken away, from those roles.
 *
 * Only permissions the system actually checks somewhere, so a tick box never
 * promises something that does nothing. `users.manage` is left out on purpose:
 * somebody who can manage people can give themselves anything, which makes
 * them a manager in all but name, and that should be done by making them one.
 */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = [
  'clients.view.all',
  'clients.view.assigned',
  'clients.edit',
  'clients.vault.read',
  'projects.view.all',
  'projects.edit',
  'projects.assign',
  'time.record',
  'time.edit.any',
  'billing.view',
  'billing.approve',
  'billing.invoice.issue',
  'billing.entries.unlink',
  'audit.read',
];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isGrantable(value: string): value is Permission {
  return (GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The matrix in force, from what the firm has chosen for the editable roles.
 *
 * A role the firm has not touched keeps its defaults. For one it has, the
 * grantable part is exactly what was chosen and the rest of its defaults stay,
 * so permissions with no tick box are never lost by saving the screen.
 */
export function effectiveMatrix(chosen: Partial<Record<Role, readonly string[]>>): RoleMatrix {
  const matrix = { ...MATRIX } as Record<Role, readonly Permission[]>;
  for (const role of EDITABLE_ROLES) {
    const picked = chosen[role];
    if (!picked) continue;
    const kept = MATRIX[role].filter((permission) => !isGrantable(permission));
    const granted = picked.filter(isGrantable);
    matrix[role] = [...new Set([...kept, ...granted])];
  }
  return matrix;
}

export function permissionsFor(
  roles: readonly Role[],
  matrix: RoleMatrix = MATRIX,
): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of matrix[role]) granted.add(permission);
  }
  return granted;
}

export function roleHas(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Roles that must carry a second factor. The manager can see and change everything. */
export const ROLES_REQUIRING_TWO_FACTOR: readonly Role[] = ['manager'];
