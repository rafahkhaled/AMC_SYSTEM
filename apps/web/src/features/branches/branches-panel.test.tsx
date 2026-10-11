import type { BranchView } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { BranchesPanel } from './branches-panel.js';

const listBranches = vi.hoisted(() => vi.fn());
const addBranch = vi.hoisted(() => vi.fn());
const changeBranch = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ listBranches, addBranch, changeBranch }));

const branch = (over: Partial<BranchView> = {}): BranchView => ({
  code: 'dubai',
  nameEn: 'Dubai Branch',
  nameAr: 'فرع دبي',
  addresses: [],
  bank: null,
  logoUrl: null,
  stampUrl: null,
  retired: false,
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  listBranches.mockResolvedValue([
    branch(),
    branch({
      code: 'ajman',
      nameEn: 'Ajman Branch',
      nameAr: 'فرع عجمان',
      addresses: ['Ajman: Office 12'],
    }),
  ]);
});

describe('the firm’s branches (feedback item 12b)', () => {
  it('lists them with their addresses, and says which have none yet', async () => {
    renderScreen(<BranchesPanel />);

    expect(await screen.findByText('Dubai Branch')).toBeInTheDocument();
    expect(screen.getByText('Ajman: Office 12')).toBeInTheDocument();
    // Said rather than left blank, so it is clear the firm-wide ones will print.
    expect(screen.getByText('No address yet, so the firm-wide ones print.')).toBeInTheDocument();
  });

  it('adds a branch with addresses, one per line, and its own bank account', async () => {
    addBranch.mockResolvedValue(branch());
    renderScreen(<BranchesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'Sharjah Branch');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'فرع الشارقة');
    await userEvent.type(screen.getByLabelText('Addresses'), 'Sharjah: Office 4{enter}PO Box 99');
    await userEvent.type(screen.getByLabelText('Account holder'), 'Active M - Sharjah');
    await userEvent.type(screen.getByLabelText('IBAN'), 'AE-SHJ-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save the branch' }));

    await waitFor(() =>
      expect(addBranch).toHaveBeenCalledWith({
        nameEn: 'Sharjah Branch',
        nameAr: 'فرع الشارقة',
        addresses: ['Sharjah: Office 4', 'PO Box 99'],
        bank: { accountHolder: 'Active M - Sharjah', iban: 'AE-SHJ-1', bic: null },
        logoUrl: null,
        stampUrl: null,
      }),
    );
  });

  it('leaves the bank account out entirely when none is given, so the firm’s prints', async () => {
    addBranch.mockResolvedValue(branch());
    renderScreen(<BranchesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'Sharjah Branch');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'فرع الشارقة');
    await userEvent.click(screen.getByRole('button', { name: 'Save the branch' }));

    await waitFor(() =>
      expect(addBranch).toHaveBeenCalledWith(expect.objectContaining({ bank: null })),
    );
  });

  it('will not save half a bank account', async () => {
    renderScreen(<BranchesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'X');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    // An IBAN with nobody to say whose it is, which is a payment to a stranger.
    await userEvent.type(screen.getByLabelText('IBAN'), 'AE-1');

    expect(screen.getByRole('button', { name: 'Save the branch' })).toBeDisabled();
  });

  it('will not save without a name in both languages', async () => {
    renderScreen(<BranchesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));

    await userEvent.type(screen.getByLabelText('Name in English'), 'Only English');
    expect(screen.getByRole('button', { name: 'Save the branch' })).toBeDisabled();
  });

  it('edits one, starting from what it already says', async () => {
    changeBranch.mockResolvedValue(branch());
    renderScreen(<BranchesPanel />);

    const edits = await screen.findAllByRole('button', { name: 'Edit' });
    await userEvent.click(edits[1] as HTMLElement);

    expect(screen.getByLabelText('Addresses')).toHaveValue('Ajman: Office 12');
    await userEvent.type(screen.getByLabelText('Addresses'), '{enter}Ajman PO Box 5');
    await userEvent.click(screen.getByRole('button', { name: 'Save the branch' }));

    await waitFor(() =>
      expect(changeBranch).toHaveBeenCalledWith(
        'ajman',
        expect.objectContaining({ addresses: ['Ajman: Office 12', 'Ajman PO Box 5'] }),
      ),
    );
  });

  it('retires one rather than deleting it', async () => {
    changeBranch.mockResolvedValue(branch({ retired: true }));
    renderScreen(<BranchesPanel />);

    const retires = await screen.findAllByRole('button', { name: 'Retire' });
    await userEvent.click(retires[0] as HTMLElement);

    await waitFor(() => expect(changeBranch).toHaveBeenCalledWith('dubai', { retired: true }));
  });

  it('shows the server’s refusal in its own words', async () => {
    addBranch.mockRejectedValue(new Error('Give the English name using letters or numbers'));
    renderScreen(<BranchesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    await userEvent.type(screen.getByLabelText('Name in English'), '!!!');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    await userEvent.click(screen.getByRole('button', { name: 'Save the branch' }));

    expect(await screen.findByText(/using letters or numbers/)).toBeInTheDocument();
  });
});
