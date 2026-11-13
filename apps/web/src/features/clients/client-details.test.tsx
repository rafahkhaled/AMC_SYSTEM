import type { ClientDetail } from '@amc/contracts';
import { cleanup, screen, waitFor } from '@testing-library/react';
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
  number: 7,
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
  mobile2: null,
  weeklyDayOff: 0,
  address: 'Office 523, Block C, DAFZA, Dubai',
  opensAt: '08:30',
  closesAt: '17:30',
  vatRemark: null,
  ctRemark: null,
  taxLoginMethod: null,
  ctReturnDueOn: null,
  ctReturnFiledOn: null,
  ctReturnStatus: null,
  vatReturns: [],
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
    await user.type(screen.getByLabelText('Tax registration number (VAT)'), '100111222333003');
    expect(screen.getByLabelText('Filed')).toBeInTheDocument();
    // No months assumed: saving waits until they are chosen.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      (await screen.findAllByText('Choose the months the periods end in before saving')).length,
    ).toBeGreaterThan(0);
    expect(changeClientDetails).not.toHaveBeenCalled();

    // Choosing one sets all four, and dates the four returns from them.
    await user.selectOptions(screen.getByLabelText('Return 1'), '1');
    expect(screen.getByLabelText('Return 2')).toHaveValue('4');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(changeClientDetails).toHaveBeenCalled());
    const sent = changeClientDetails.mock.calls[0]?.[1];
    expect(sent.vat).toEqual({ trn: '100111222333003', frequency: 'quarterly', anchorEndMonth: 1 });
    expect(sent.vatReturns.map((one: { dueOn: string }) => one.dueOn.slice(5)).sort()).toEqual([
      '02-28',
      '05-28',
      '08-28',
      '11-28',
    ]);
  });

  it('hides the VAT return dates for a client with no VAT number', async () => {
    const user = userEvent.setup();
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByText('The four VAT returns')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tax registration number (VAT)'), 'NA');
    expect(screen.queryByText('The four VAT returns')).toBeNull();
  });

  it('shows the refusal in the form instead of closing it', async () => {
    const user = userEvent.setup();
    changeClientDetails.mockRejectedValue(new Error('That is not an email address'));
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Under the box it is about, and at the foot of the form.
    expect(await screen.findAllByText('That is not an email address')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps what was typed when the save fails, and brings it back next time', async () => {
    const user = userEvent.setup();
    changeClientDetails.mockRejectedValue(new Error('That is not an email address'));
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const person = screen.getByLabelText('Contact person');
    await user.clear(person);
    await user.type(person, 'Someone new');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findAllByText('That is not an email address');
    // Closed, as when somebody gives up and comes back later.
    cleanup();

    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByLabelText('Contact person')).toHaveValue('Someone new');
    expect(screen.getByText(/did not save is back/)).toBeInTheDocument();
  });

  it('shows the address and the hours the client keeps', () => {
    renderScreen(<ClientDetailsCard detail={client()} canEdit={false} months={MONTHS} />);
    expect(screen.getByText('Office 523, Block C, DAFZA, Dubai')).toBeInTheDocument();
    expect(screen.getByText('08:30 – 17:30')).toBeInTheDocument();
  });

  it('sends the address and hours that were typed', async () => {
    const user = userEvent.setup();
    renderScreen(<ClientDetailsCard detail={client()} canEdit months={MONTHS} />);

    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'Ajman Media City');
    await user.clear(screen.getByLabelText('Closes'));
    await user.type(screen.getByLabelText('Closes'), '18:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(changeClientDetails).toHaveBeenCalled());
    expect(changeClientDetails.mock.calls[0]?.[1]).toMatchObject({
      address: 'Ajman Media City',
      opensAt: '08:30',
      closesAt: '18:00',
    });
  });
});

describe('the four VAT return months', () => {
  it('are the same four whichever of them was chosen, in calendar order', async () => {
    const { quarterMonths } = await import('./client-details.js');
    expect(quarterMonths(11)).toEqual([2, 5, 8, 11]);
    expect(quarterMonths(2)).toEqual([2, 5, 8, 11]);
    expect(quarterMonths(3)).toEqual([3, 6, 9, 12]);
  });
});

describe('what a tax number box holds', () => {
  it('is a number when it is digits, and the firm’s words otherwise', async () => {
    const { remarkOf, remarkText } = await import('./client-details.js');
    expect(remarkOf('100 123-456 700003')).toBeNull();
    expect(remarkOf('n/a')).toBe('na');
    expect(remarkOf('Rejection')).toBe('rejected');
    expect(remarkOf('De-Reg')).toBe('De-Reg');
    expect(remarkText('De-Reg')).toBe('De-Reg');
    expect(remarkText('na')).toBe('NA');
  });
});
