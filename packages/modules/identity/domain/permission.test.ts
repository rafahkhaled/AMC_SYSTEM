import { describe, expect, it } from 'vitest';
import { permissionsFor, roleHas } from './permission.js';

/**
 * These assertions come straight from the role table in SRS 2.2. If the
 * requirements change, this file is the first thing that should fail.
 */
describe('the role matrix from SRS 2.2', () => {
  it('lets the manager see every client and an accountant only their assigned ones', () => {
    expect(roleHas('manager', 'clients.view.all')).toBe(true);
    expect(roleHas('accountant', 'clients.view.all')).toBe(false);
    expect(roleHas('accountant', 'clients.view.assigned')).toBe(true);
  });

  it('keeps rate changes and user management with the manager alone', () => {
    for (const role of ['accountant', 'data_entry', 'client'] as const) {
      expect(roleHas(role, 'clients.rates.manage')).toBe(false);
      expect(roleHas(role, 'users.manage')).toBe(false);
    }
    expect(roleHas('manager', 'clients.rates.manage')).toBe(true);
    expect(roleHas('manager', 'users.manage')).toBe(true);
  });

  it('never lets data entry approve anything', () => {
    const permissions = permissionsFor(['data_entry']);
    for (const permission of permissions) {
      expect(permission).not.toMatch(/approve/);
    }
    expect(permissions.has('invoices.upload')).toBe(true);
    expect(permissions.has('invoices.correct')).toBe(true);
  });

  it('limits an accountant to approving within their own clients', () => {
    expect(roleHas('accountant', 'invoices.approve.assigned')).toBe(true);
    expect(roleHas('accountant', 'invoices.approve.all')).toBe(false);
    expect(roleHas('manager', 'invoices.approve.all')).toBe(true);
  });

  it('gives an accountant Excel export but not everything', () => {
    expect(roleHas('accountant', 'export.excel')).toBe(true);
    expect(roleHas('accountant', 'export.all')).toBe(false);
  });

  it('confines a portal client to their own documents', () => {
    expect([...permissionsFor(['client'])].sort()).toEqual([
      'portal.self.upload',
      'portal.self.view',
    ]);
  });

  it('keeps billing approval away from every role but the manager', () => {
    expect(roleHas('manager', 'billing.approve')).toBe(true);
    for (const role of ['accountant', 'data_entry', 'client'] as const) {
      expect(roleHas(role, 'billing.approve')).toBe(false);
    }
  });

  it('unions the permissions of someone holding two roles', () => {
    const both = permissionsFor(['accountant', 'data_entry']);
    expect(both.has('time.record')).toBe(true);
    expect(both.has('invoices.upload')).toBe(true);
    expect(both.has('users.manage')).toBe(false);
  });
});
