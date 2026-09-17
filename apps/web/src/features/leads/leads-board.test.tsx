import type { LeadBoard, LeadView } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { LeadsBoard } from './leads-board.js';

const leadBoard = vi.hoisted(() => vi.fn());
const captureLead = vi.hoisted(() => vi.fn());
const moveLead = vi.hoisted(() => vi.fn());
const convertLead = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ leadBoard, captureLead, moveLead, convertLead }));

function lead(over: Partial<LeadView> = {}): LeadView {
  return {
    id: 'lead-1',
    name: 'Al Manara Foodstuff',
    phone: '+971 50 111 2222',
    email: null,
    source: 'whatsapp',
    sourceDetail: null,
    requestedService: 'VAT registration',
    status: 'new',
    convertedClientId: null,
    receivedAt: '2026-09-15T06:00:00.000Z',
    notes: null,
    allowedNext: ['contacted', 'declined'],
    waitingDays: 2,
    ...over,
  };
}

function board(byStatus: Partial<Record<LeadView['status'], LeadView[]>> = {}): LeadBoard {
  const columns = ['new', 'contacted', 'quoted', 'declined'] as const;
  return { columns: columns.map((status) => ({ status, leads: byStatus[status] ?? [] })) };
}

function show(view: LeadBoard, onOpenClient = vi.fn()) {
  leadBoard.mockResolvedValue(view);
  renderScreen(<LeadsBoard onOpenClient={onOpenClient} />);
  return onOpenClient;
}

describe('the enquiry pipeline (FR-01)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useLanguage('en');
  });

  it('shows what is being lost as well as what is in play', async () => {
    /*
     * Confirmed is absent and declined is present, which looks backwards until
     * you ask what the board is for. A confirmed enquiry has become a client
     * and lives on the clients list; a declined one is the column that tells a
     * partner what is being lost.
     */
    show(board({ new: [lead()] }));

    const columns = await screen.findAllByRole('heading', { level: 2 });
    expect(columns.map((heading) => heading.textContent)).toEqual([
      'New',
      'Contacted',
      'Quoted',
      'Declined',
    ]);
  });

  it('offers only the steps the pipeline allows', async () => {
    // Read from the domain's own transition table, so a screen cannot offer a
    // step that would be refused.
    show(board({ new: [lead()] }));

    expect(await screen.findByRole('button', { name: 'Contacted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Declined' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmed' })).not.toBeInTheDocument();
  });

  it('never offers a jump straight to a client', async () => {
    // Converting is the only way, or a client appears that nobody has quoted.
    show(
      board({ contacted: [lead({ status: 'contacted', allowedNext: ['quoted', 'declined'] })] }),
    );

    await screen.findByText('Al Manara Foodstuff');
    expect(screen.queryByRole('button', { name: 'Make a client' })).not.toBeInTheDocument();
  });

  it('offers conversion once an enquiry has been quoted', async () => {
    show(board({ quoted: [lead({ status: 'quoted', allowedNext: ['confirmed', 'declined'] })] }));
    expect(await screen.findByRole('button', { name: 'Make a client' })).toBeInTheDocument();
  });

  it('says how long an enquiry has been waiting, not when it arrived', async () => {
    // "Eight days" is the number somebody acts on. A date is one they have to
    // subtract from first.
    show(board({ new: [lead({ waitingDays: 8 })] }));
    expect(await screen.findByText('waiting 8 days')).toBeInTheDocument();
  });

  it('marks an enquiry nobody has answered for a week', async () => {
    show(board({ new: [lead({ waitingDays: 9 })] }));
    expect(await screen.findByText('waiting 9 days')).toHaveClass('u-danger');
  });

  it('does not mark one that arrived this morning', async () => {
    show(board({ new: [lead({ waitingDays: 0 })] }));
    expect(await screen.findByText('today')).not.toHaveClass('u-danger');
  });

  it('moves an enquiry along', async () => {
    const user = userEvent.setup();
    show(board({ new: [lead()] }));
    moveLead.mockResolvedValue(board({ contacted: [lead({ status: 'contacted' })] }));

    await user.click(await screen.findByRole('button', { name: 'Contacted' }));

    expect(moveLead.mock.calls[0]?.slice(0, 2)).toEqual(['lead-1', 'contacted']);
  });

  it('asks for the legal name before making a client of somebody', async () => {
    // As it reads on the trade licence, not as it was written in a WhatsApp
    // message, which is where most of these names come from.
    const user = userEvent.setup();
    show(board({ quoted: [lead({ status: 'quoted', allowedNext: ['confirmed'] })] }));

    await user.click(await screen.findByRole('button', { name: 'Make a client' }));

    expect(screen.getByLabelText('Legal name')).toBeInTheDocument();
    expect(
      screen.getByText('As it reads on the trade licence, not as it was written in the message.'),
    ).toBeInTheDocument();
  });

  it('opens the new client once the enquiry becomes one', async () => {
    const user = userEvent.setup();
    const onOpenClient = show(board({ quoted: [lead({ status: 'quoted', allowedNext: [] })] }));
    convertLead.mockResolvedValue({ clientId: 'client-9', board: board() });

    await user.click(await screen.findByRole('button', { name: 'Make a client' }));
    await user.click(screen.getByRole('button', { name: 'Create the client' }));

    expect(onOpenClient).toHaveBeenCalledWith('client-9');
  });

  it('will not take an enquiry with no way to reach anybody', async () => {
    // Somebody has to be reachable, or it cannot be followed up and is not
    // really an enquiry. The server refuses it too.
    const user = userEvent.setup();
    show(board());

    await user.click(await screen.findByRole('button', { name: 'New enquiry' }));
    await user.type(screen.getByLabelText('Name'), 'Someone');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('takes one with only an email', async () => {
    const user = userEvent.setup();
    show(board());
    captureLead.mockResolvedValue(board());

    await user.click(await screen.findByRole('button', { name: 'New enquiry' }));
    await user.type(screen.getByLabelText('Name'), 'Desert Rose Interiors');
    await user.type(screen.getByLabelText('Email'), 'info@desertrose.ae');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(captureLead).toHaveBeenCalledWith({
      name: 'Desert Rose Interiors',
      email: 'info@desertrose.ae',
      source: 'whatsapp',
    });
  });

  it('says the pipeline is empty rather than showing four blank columns', async () => {
    show(board());
    expect(await screen.findByText('No enquiries')).toBeInTheDocument();
  });
});
