import type { RolePermissions } from '@amc/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { RolesPanel } from './roles-panel.js';

const rolePermissions = vi.hoisted(() => vi.fn());
const chooseRolePermissions = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ rolePermissions, chooseRolePermissions }));

const GRANTABLE = [
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

const matrix = (
  accountant: string[] = ['clients.view.assigned', 'billing.view'],
): RolePermissions => ({
  roles: [
    { role: 'manager', editable: false, permissions: GRANTABLE, defaults: GRANTABLE },
    {
      role: 'accountant',
      editable: true,
      permissions: accountant,
      defaults: ['clients.view.assigned', 'billing.view'],
    },
    { role: 'data_entry', editable: true, permissions: [], defaults: [] },
  ],
  grantable: GRANTABLE,
});

/** The card for one role, found by its heading. */
async function card(name: string) {
  const heading = await screen.findByRole('heading', { name });
  return within(heading.closest('section') as HTMLElement);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  rolePermissions.mockResolvedValue(matrix());
});

describe('roles and permissions', () => {
  it('shows each role with what it may do ticked', async () => {
    renderScreen(<RolesPanel />);

    const accountant = await card('Accountant');
    expect(accountant.getByRole('checkbox', { name: /See billing/ })).toBeChecked();
    expect(accountant.getByRole('checkbox', { name: /Edit clients/ })).not.toBeChecked();
  });

  it('shows the manager’s permissions but will not let them be changed', async () => {
    renderScreen(<RolesPanel />);

    const manager = await card('Manager');
    for (const box of manager.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(manager.queryByRole('button', { name: 'Save permissions' })).toBeNull();
    expect(manager.getByText('Fixed')).toBeInTheDocument();
  });

  it('saves the whole list for the role, with the new tick in it', async () => {
    const user = userEvent.setup();
    chooseRolePermissions.mockResolvedValue(
      matrix(['clients.view.assigned', 'billing.view', 'clients.edit']),
    );
    renderScreen(<RolesPanel />);

    const accountant = await card('Accountant');
    expect(accountant.getByRole('button', { name: 'Save permissions' })).toBeDisabled();
    await user.click(accountant.getByRole('checkbox', { name: /Edit clients/ }));
    await user.click(accountant.getByRole('button', { name: 'Save permissions' }));

    await waitFor(() => expect(chooseRolePermissions).toHaveBeenCalled());
    expect(chooseRolePermissions.mock.calls[0]?.[0]).toBe('accountant');
    expect([...(chooseRolePermissions.mock.calls[0]?.[1] ?? [])].sort()).toEqual([
      'billing.view',
      'clients.edit',
      'clients.view.assigned',
    ]);
    expect(await screen.findByText('Saved. It applies straight away.')).toBeInTheDocument();
  });

  it('puts the original settings back in the boxes before saving', async () => {
    const user = userEvent.setup();
    rolePermissions.mockResolvedValue(matrix(['clients.edit']));
    renderScreen(<RolesPanel />);

    const accountant = await card('Accountant');
    await user.click(accountant.getByRole('button', { name: 'Back to the original settings' }));
    expect(accountant.getByRole('checkbox', { name: /See billing/ })).toBeChecked();
    expect(accountant.getByRole('checkbox', { name: /Edit clients/ })).not.toBeChecked();
    expect(chooseRolePermissions).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    chooseRolePermissions.mockRejectedValue(new Error('Not something that can be granted'));
    renderScreen(<RolesPanel />);

    const accountant = await card('Accountant');
    await user.click(accountant.getByRole('checkbox', { name: /Audit log/ }));
    await user.click(accountant.getByRole('button', { name: 'Save permissions' }));

    expect(await screen.findByText('Not something that can be granted')).toBeInTheDocument();
  });
});
