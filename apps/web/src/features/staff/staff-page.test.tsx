import type { StaffMember } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { StaffPage } from './staff-page.js';

const staffDirectory = vi.hoisted(() => vi.fn());
const addStaff = vi.hoisted(() => vi.fn());
const updateStaff = vi.hoisted(() => vi.fn());
const setStaffStatus = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ staffDirectory, addStaff, updateStaff, setStaffStatus }));

const person = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'u-1',
  displayName: 'Hana Saeed',
  email: 'hana@activemanagement.ae',
  roles: ['accountant'],
  status: 'active',
  workingHours: { startsAt: '09:00', endsAt: '18:00', days: [1, 2, 3, 4, 5] },
  clients: 4,
  openProjects: 6,
  overdueProjects: 0,
  thisMonthSeconds: 32_400,
  lastMonthSeconds: 0,
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  staffDirectory.mockResolvedValue([person()]);
});

describe('the employee directory', () => {
  it('answers what somebody is carrying without opening four screens', async () => {
    renderScreen(<StaffPage />);

    expect(await screen.findByText('Hana Saeed')).toBeInTheDocument();
    expect(screen.getByText('Accountant')).toBeInTheDocument();
    expect(screen.getByText('09:00–18:00')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('9:00')).toBeInTheDocument();
  });

  it('marks somebody carrying overdue work', async () => {
    staffDirectory.mockResolvedValue([person({ overdueProjects: 3 })]);
    renderScreen(<StaffPage />);

    expect(await screen.findByText('3 overdue')).toBeInTheDocument();
  });

  it('says nothing rather than “under a minute” for a month with no hours', async () => {
    renderScreen(<StaffPage />);

    // A row claiming a colleague worked under a minute, when they booked
    // nothing at all, is a different and worse claim than an empty cell.
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Under a minute')).not.toBeInTheDocument();
  });

  it('leaves the hours columns out entirely for somebody who may not see them', async () => {
    staffDirectory.mockResolvedValue([person({ thisMonthSeconds: null, lastMonthSeconds: null })]);
    renderScreen(<StaffPage />);

    // The server withholds them rather than sending zeros, so the screen has
    // nothing to accidentally render as "booked nothing this month".
    expect(await screen.findByText('Hana Saeed')).toBeInTheDocument();
    expect(screen.queryByText('This month')).not.toBeInTheDocument();
    expect(screen.getByText('Clients')).toBeInTheDocument();
  });

  it('says when somebody has no working hours set', async () => {
    staffDirectory.mockResolvedValue([person({ workingHours: null })]);
    renderScreen(<StaffPage />);

    expect(await screen.findByText('not set')).toBeInTheDocument();
  });
});

describe('managing people', () => {
  it('offers nothing to change to somebody who does not manage people', async () => {
    renderScreen(<StaffPage />);

    expect(await screen.findByText('Hana Saeed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an employee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('adds a colleague with a role and an initial password', async () => {
    addStaff.mockResolvedValue([person()]);
    renderScreen(<StaffPage canManage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add an employee' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Omar Nasser');
    await userEvent.type(screen.getByLabelText('Email address'), 'omar@activemanagement.ae');
    await userEvent.type(screen.getByLabelText('Initial password'), 'a long enough one');
    await userEvent.click(screen.getByRole('button', { name: 'Add them' }));

    expect(addStaff).toHaveBeenCalledWith({
      email: 'omar@activemanagement.ae',
      displayName: 'Omar Nasser',
      password: 'a long enough one',
      roles: ['accountant'],
    });
  });

  it('suspends rather than deletes', async () => {
    setStaffStatus.mockResolvedValue([person({ status: 'suspended' })]);
    renderScreen(<StaffPage canManage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    /*
     * There is no delete, and there should not be: this person's id is on
     * every hour they recorded and every audit row they caused.
     */
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suspend account' }));
    expect(setStaffStatus).toHaveBeenCalledWith('u-1', 'suspended');
  });

  it('saves a name, a role and the days somebody works together', async () => {
    updateStaff.mockResolvedValue([person()]);
    renderScreen(<StaffPage canManage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // One act: somebody opened a record and put it right.
    expect(updateStaff).toHaveBeenCalledWith('u-1', {
      displayName: 'Hana Saeed',
      roles: ['accountant'],
      workingHours: { startsAt: '09:00', endsAt: '18:00', days: [1, 2, 3, 4, 5, 6] },
    });
  });

  it('marks a suspended colleague on the list', async () => {
    staffDirectory.mockResolvedValue([person({ status: 'suspended' })]);
    renderScreen(<StaffPage canManage />);

    expect(await screen.findByText('Suspended')).toBeInTheDocument();
  });
});
