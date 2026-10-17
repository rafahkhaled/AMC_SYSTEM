import type { CampaignView } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { CampaignsPanel } from './campaigns-panel.js';

const listCampaigns = vi.hoisted(() => vi.fn());
const addCampaign = vi.hoisted(() => vi.fn());
const changeCampaign = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ listCampaigns, addCampaign, changeCampaign }));

const referenceOptions = vi.hoisted(() => vi.fn());
vi.mock('../lists/api.js', () => ({ referenceOptions }));

const staffDirectory = vi.hoisted(() => vi.fn());
vi.mock('../staff/api.js', () => ({ staffDirectory }));

const campaign = (over: Partial<CampaignView> = {}): CampaignView => ({
  id: 'camp-1',
  name: 'Ramadan offer',
  typeCode: 'instagram',
  startsOn: '2026-10-01',
  durationDays: 30,
  endsOn: '2026-10-30',
  salespersonId: 'u-1',
  salespersonName: 'Wael Ajam',
  notes: null,
  status: 'active',
  costMinor: 450_000,
  currency: 'AED',
  leads: 5,
  clients: 2,
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  listCampaigns.mockResolvedValue([campaign()]);
  referenceOptions.mockResolvedValue([
    {
      id: '1',
      list: 'campaign_type',
      code: 'whatsapp',
      nameEn: 'WhatsApp',
      nameAr: 'واتساب',
      position: 10,
      retired: false,
    },
    {
      id: '2',
      list: 'campaign_type',
      code: 'instagram',
      nameEn: 'Instagram',
      nameAr: 'إنستغرام',
      position: 20,
      retired: false,
    },
  ]);
  staffDirectory.mockResolvedValue([{ id: 'u-1', displayName: 'Wael Ajam' }]);
});

describe('the campaigns list', () => {
  it('shows each campaign with its channel, dates, salesperson, cost and what it brought in', async () => {
    renderScreen(<CampaignsPanel />);

    expect(await screen.findByText('Ramadan offer')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01 → 2026-10-30')).toBeInTheDocument();
    expect(screen.getByText('Wael Ajam')).toBeInTheDocument();
    expect(screen.getByText('5 enquiries · 2 clients')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    listCampaigns.mockResolvedValue([]);
    renderScreen(<CampaignsPanel />);
    expect(await screen.findByText('No campaigns yet.')).toBeInTheDocument();
  });

  it('adds a campaign, sending the cost in fils', async () => {
    const user = userEvent.setup();
    addCampaign.mockResolvedValue(campaign());
    renderScreen(<CampaignsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Add a campaign' }));
    await user.type(screen.getByLabelText('Campaign name'), 'Summer reels');
    await user.selectOptions(screen.getByLabelText('Campaign type'), 'whatsapp');
    await user.clear(screen.getByLabelText('Cost'));
    await user.type(screen.getByLabelText('Cost'), '1,250.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addCampaign).toHaveBeenCalled());
    expect(addCampaign.mock.calls[0]?.[0]).toMatchObject({
      name: 'Summer reels',
      typeCode: 'whatsapp',
      costMinor: 125_050,
    });
  });

  it('will not save a campaign without a name, or with a cost that is not an amount', async () => {
    const user = userEvent.setup();
    renderScreen(<CampaignsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Add a campaign' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Campaign name'), 'Summer reels');
    await user.clear(screen.getByLabelText('Cost'));
    await user.type(screen.getByLabelText('Cost'), 'a lot');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Enter a valid amount')).toBeInTheDocument();
  });

  it('edits a campaign, clearing the salesperson when none is chosen', async () => {
    const user = userEvent.setup();
    changeCampaign.mockResolvedValue(campaign());
    renderScreen(<CampaignsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.selectOptions(await screen.findByLabelText('Salesperson'), '');
    await user.selectOptions(screen.getByLabelText('Status'), 'ended');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(changeCampaign).toHaveBeenCalled());
    expect(changeCampaign.mock.calls[0]?.[0]).toBe('camp-1');
    expect(changeCampaign.mock.calls[0]?.[1]).toMatchObject({
      salespersonId: null,
      status: 'ended',
    });
  });

  it('shows the server’s refusal and keeps the form open', async () => {
    const user = userEvent.setup();
    addCampaign.mockRejectedValue(new Error('That is not a type of campaign the firm uses'));
    renderScreen(<CampaignsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Add a campaign' }));
    await user.type(screen.getByLabelText('Campaign name'), 'Summer reels');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('That is not a type of campaign the firm uses'),
    ).toBeInTheDocument();
  });
});
