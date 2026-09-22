import type { PendingApproval } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ApprovalsPanel } from './approvals.js';

const pendingApprovals = vi.hoisted(() => vi.fn());
const approveEntries = vi.hoisted(() => vi.fn());

vi.mock('./api.js', () => ({ pendingApprovals, approveEntries }));

const entry = (over: Partial<PendingApproval> = {}): PendingApproval => ({
  id: 'e-1',
  userId: 'u-1',
  userName: 'Hana Saeed',
  clientName: 'Gulf Trading LLC',
  service: 'vat_return',
  projectId: 'p-1',
  day: '2026-09-03',
  seconds: 9000,
  billable: true,
  source: 'manual',
  reason: 'Worked from the client office, timer left at the desk',
  reviewReason: null,
  reviewedAt: null,
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  pendingApprovals.mockResolvedValue([entry()]);
  approveEntries.mockResolvedValue({ approved: ['e-1'], refused: [] });
});

describe('the approval queue', () => {
  it('shows whose hours they are, for which client, and why they were typed', async () => {
    renderScreen(<ApprovalsPanel />);

    expect(await screen.findByText('Gulf Trading LLC')).toBeInTheDocument();
    expect(screen.getByText(/Hana Saeed/)).toBeInTheDocument();
    // The reason is required on a manual entry and is the thing a manager is
    // actually reading before saying yes.
    expect(
      screen.getByText('Worked from the client office, timer left at the desk'),
    ).toBeInTheDocument();
  });

  it('approves nothing until something is chosen', async () => {
    renderScreen(<ApprovalsPanel />);

    const button = await screen.findByRole('button', { name: 'Approve' });
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve 1 entry' }));

    expect(approveEntries).toHaveBeenCalledWith(['e-1']);
  });

  it('says which entries it could not approve, in the server’s own words', async () => {
    approveEntries.mockResolvedValue({
      approved: [],
      refused: [{ id: 'e-1', because: 'This time has not finished yet' }],
    });
    renderScreen(<ApprovalsPanel />);

    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Approve 1 entry' }));

    // A bulk approval that silently does nine of ten is worse than one that
    // says which one it would not touch.
    expect(await screen.findByText(/1 entry was not approved/)).toBeInTheDocument();
    expect(screen.getByText(/This time has not finished yet/)).toBeInTheDocument();
  });

  it('marks an entry nobody has confirmed yet', async () => {
    pendingApprovals.mockResolvedValue([entry({ reviewReason: 'implausible' })]);
    renderScreen(<ApprovalsPanel />);

    // The entry the person who worked it has not vouched for is the one a
    // manager should look at hardest.
    expect(await screen.findByText('Unusually long')).toBeInTheDocument();
  });

  it('says so when there is nothing waiting', async () => {
    pendingApprovals.mockResolvedValue([]);
    renderScreen(<ApprovalsPanel />);

    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
  });
});
