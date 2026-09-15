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

  // Tasks and time
  'tasks.view.all',
  'tasks.view.assigned',
  'tasks.edit',
  'tasks.assign',
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
    'tasks.view.all',
    'tasks.edit',
    'tasks.assign',
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
    'tasks.view.assigned',
    'tasks.edit',
    'time.record',
    'billing.view',
    'invoices.upload',
    'invoices.correct',
    'invoices.approve.assigned',
    'export.excel',
  ],
  data_entry: ['tasks.view.assigned', 'invoices.upload', 'invoices.correct'],
  client: ['portal.self.view', 'portal.self.upload'],
};

export function permissionsFor(roles: readonly Role[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of MATRIX[role]) granted.add(permission);
  }
  return granted;
}

export function roleHas(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** Roles that must carry a second factor. The manager can see and change everything. */
export const ROLES_REQUIRING_TWO_FACTOR: readonly Role[] = ['manager'];
