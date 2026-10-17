import type { ClientDetail } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ClientDetailsCard } from './client-details.js';

const changeClientDetails = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ changeClientDetails }));

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const client = (over: Partial<ClientDetail> = {}): ClientDetail => ({
  id: 'c-1',
  legalName: 'Gulf Trading LLC',
  legalNameArabic: null,
  status: 'active',
  vatState: 'not_registered',
  vatTrn: null,
  ctState: 'not_registered',
  documentsExpiring: 0,
  openProjects: 0,
  tradeLicenceNumber: 'CN-1234567',
  contactPerson: 'Mariam Al Suwaidi',
  contactEmail: 'mariam@gulf.example',
  mobile: '050 123 4567',
  landline: '04 123 4567',
  weeklyDayOff: 0,
  references: [{ label: 'MOL number', value: '99887766' }],
  ctTrn: null,
  vatPeriodEndMonths: [],
  financialYearEndMonth: null,
  currentRate: null,
  rateHistory: [],
  documents: [],
  projects: [],
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  changeClientDetails.mockResolvedValue(client());
});

describe('a client’s contact details', () => {
  it('shows who to call, the day off, and the firm’s own reference numbers', () => {
    renderScreen(<ClientDetailsCard detail={client()} canEdit={false} months={MONTHS} />);

    expect(screen.getByText('Mariam Al Suwaidi')).toBeInTheDocument();
    expect(screen.getByText('050 123 4567')).toBeInTheDocument();
    expect(screen.getByText('Sunday')).toBeInTheDocument();
    expect(screen.getByText('MOL number')).toBeInTheDocument();
    expect(screen.getByText('99887766')).toBeInTheDocument();
  });

  it('offers editing only to people who may edit clients', () => {
    renderScreen(<ClientDetailsCard detail={client()} canEdit={false} months={MONTHS} />);
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
  });

  it('sends what was typed, and clears a field that was emptied', async () => {
    const user = userEvent.setup();
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await user.clear(screen.getByLabelText('Mobile'));
    await user.clear(screen.getByLabelText('Contact person'));
    await user.type(screen.getByLabelText('Contact person'), 'Omar Haddad');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(changeClientDetails).toHaveBeenCalled());
    expect(changeClientDetails.mock.calls[0]?.[1]).toMatchObject({
      contactPerson: 'Omar Haddad',
      mobile: null,
      weeklyDayOff: 0,
      references: [{ label: 'MOL number', value: '99887766' }],
    });
  });

  it('asks how often VAT is filed only when registering a new number', async () => {
    const user = userEvent.setup();
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.queryByLabelText('Filed')).toBeNull();
    await user.type(screen.getByLabelText('VAT registration number'), '100111222333003');
    expect(screen.getByLabelText('Filed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(changeClientDetails).toHaveBeenCalled());
    expect(changeClientDetails.mock.calls[0]?.[1].vat).toEqual({
      trn: '100111222333003',
      frequency: 'quarterly',
      anchorEndMonth: 3,
    });
  });

  it('shows the refusal in the form instead of closing it', async () => {
    const user = userEvent.setup();
    changeClientDetails.mockRejectedValue(new Error('That is not an email address'));
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That is not an email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
