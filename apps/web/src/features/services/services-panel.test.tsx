import type { ServiceView } from '@amc/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ServicesPanel } from './services-panel.js';
import { registerServiceNames } from './use-services.js';

const listServices = vi.hoisted(() => vi.fn());
const addService = vi.hoisted(() => vi.fn());
const changeService = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ listServices, addService, changeService }));

const referenceOptions = vi.hoisted(() => vi.fn());
vi.mock('../lists/api.js', () => ({ referenceOptions }));

const service = (over: Partial<ServiceView> = {}): ServiceView => ({
  code: 'custom_trademark',
  nameEn: 'Trademark registration',
  nameAr: 'تسجيل علامة تجارية',
  builtIn: false,
  recurring: false,
  deadlineDays: 45,
  steps: [
    { nameEn: 'Search the register', nameAr: 'البحث في السجل' },
    { nameEn: 'File the application', nameAr: 'تقديم الطلب' },
  ],
  requiredDocuments: [{ type: 'trade_licence', mandatory: true }],
  retired: false,
  ...over,
});

const vatReturn = service({
  code: 'vat_return',
  nameEn: 'VAT return',
  nameAr: 'إقرار القيمة المضافة',
  builtIn: true,
  recurring: true,
  deadlineDays: null,
  steps: [],
  requiredDocuments: [],
});

const option = (code: string, nameEn: string) => ({
  id: code,
  list: 'document_type' as const,
  code,
  nameEn,
  nameAr: nameEn,
  position: 0,
  retired: false,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  listServices.mockResolvedValue([vatReturn, service()]);
  referenceOptions.mockResolvedValue([
    option('trade_licence', 'Trade licence'),
    option('passport', 'Passport'),
  ]);
});

describe('the services the firm offers (feedback item 8)', () => {
  it('lists the ones it added apart from the ones built in', async () => {
    renderScreen(<ServicesPanel />);

    expect(await screen.findByText('Trademark registration')).toBeInTheDocument();
    // Read-only, because their deadlines and recurrence are code.
    expect(screen.getByText('Built-in services')).toBeInTheDocument();
    expect(screen.getByText('Recurring')).toBeInTheDocument();
  });

  it('offers no way to edit a built-in one', async () => {
    renderScreen(<ServicesPanel />);
    await screen.findByText('Trademark registration');

    // One Edit button, for the one service the firm added.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  it('adds a service with steps and a required document', async () => {
    addService.mockResolvedValue(service());
    renderScreen(<ServicesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a service' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'Patent filing');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'تسجيل براءة اختراع');
    await userEvent.type(screen.getByLabelText('Deadline in days'), '60');
    await userEvent.type(screen.getByLabelText('Step 1 (English)'), 'Draft the claims');
    await userEvent.click(await screen.findByLabelText('Passport'));
    await userEvent.click(screen.getByRole('button', { name: 'Save the service' }));

    await waitFor(() =>
      expect(addService).toHaveBeenCalledWith({
        nameEn: 'Patent filing',
        nameAr: 'تسجيل براءة اختراع',
        deadlineDays: 60,
        steps: [{ nameEn: 'Draft the claims', nameAr: '' }],
        requiredDocuments: [{ type: 'passport', mandatory: true }],
      }),
    );
  });

  it('leaves the deadline to be set by hand when no days are given', async () => {
    addService.mockResolvedValue(service());
    renderScreen(<ServicesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a service' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'Audit review');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'مراجعة');
    await userEvent.type(screen.getByLabelText('Step 1 (English)'), 'Review');
    await userEvent.click(screen.getByRole('button', { name: 'Save the service' }));

    await waitFor(() =>
      expect(addService).toHaveBeenCalledWith(expect.objectContaining({ deadlineDays: null })),
    );
  });

  it('will not save without a name in both languages and a step', async () => {
    renderScreen(<ServicesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a service' }));

    const save = screen.getByRole('button', { name: 'Save the service' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name in English'), 'X');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Step 1 (English)'), 'Do it');
    expect(save).toBeEnabled();
  });

  it('does not offer to remove a step the service already had', async () => {
    renderScreen(<ServicesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    // Open projects record progress by step number, so removing step 1 would
    // relabel everything done against step 2. Only a step added in this edit
    // can be taken back out.
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add a step' }));
    const fresh = screen.getByLabelText('Step 3 (English)').closest('.u-row') as HTMLElement;
    expect(within(fresh).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('retires one rather than deleting it', async () => {
    changeService.mockResolvedValue(service({ retired: true }));
    renderScreen(<ServicesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Retire' }));
    await waitFor(() =>
      expect(changeService).toHaveBeenCalledWith('custom_trademark', { retired: true }),
    );
  });

  it('shows the server’s refusal in its own words', async () => {
    addService.mockRejectedValue(new Error('Not a document type on the list: made_up'));
    renderScreen(<ServicesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a service' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'X');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    await userEvent.type(screen.getByLabelText('Step 1 (English)'), 'Do it');
    await userEvent.click(screen.getByRole('button', { name: 'Save the service' }));

    expect(await screen.findByText(/Not a document type on the list/)).toBeInTheDocument();
  });
});

describe('naming a service on every screen', () => {
  it('teaches the translation bundle a service added today, in both languages', async () => {
    await useLanguage('en');
    expect(i18next.t('services.custom_trademark')).toBe('services.custom_trademark');

    expect(registerServiceNames([service()])).toBe(true);

    expect(i18next.t('services.custom_trademark')).toBe('Trademark registration');
    expect(i18next.t('services.custom_trademark', { lng: 'ar' })).toBe('تسجيل علامة تجارية');
  });

  it('says nothing changed the second time, so nothing re-renders for it', async () => {
    await useLanguage('en');
    registerServiceNames([service()]);
    expect(registerServiceNames([service()])).toBe(false);
  });

  it('leaves the built-in names to the translation files', async () => {
    await useLanguage('en');
    const before = i18next.t('services.vat_return');
    registerServiceNames([{ ...vatReturn, nameEn: 'Something else entirely' }]);
    expect(i18next.t('services.vat_return')).toBe(before);
  });
});
