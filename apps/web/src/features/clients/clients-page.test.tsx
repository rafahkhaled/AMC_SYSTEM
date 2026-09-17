import type { ClientSummary } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ClientsPage } from './clients-page.js';

const listClients = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ listClients, getClient: vi.fn() }));

const leadBoard = vi.hoisted(() => vi.fn());
vi.mock('../leads/api.js', () => ({
  leadBoard,
  captureLead: vi.fn(),
  moveLead: vi.fn(),
  convertLead: vi.fn(),
}));

function client(over: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: 'c-1',
    legalName: 'Gulf Trading LLC',
    legalNameArabic: null,
    status: 'active',
    vatState: 'registered',
    vatTrn: '100123456700003',
    ctState: 'not_registered',
    documentsExpiring: 0,
    openTasks: 0,
    ...over,
  };
}

function show(clients: ClientSummary[], onOpen = vi.fn()) {
  listClients.mockResolvedValue(clients);
  leadBoard.mockResolvedValue({ columns: [] });
  renderScreen(<ClientsPage onOpen={onOpen} />);
  return onOpen;
}

const THREE = [
  client(),
  client({
    id: 'c-2',
    legalName: 'Marina Contracting LLC',
    vatTrn: '100234567800003',
    documentsExpiring: 1,
  }),
  client({
    id: 'c-3',
    legalName: 'Noor Medical Supplies FZE',
    vatTrn: '100345678900003',
    openTasks: 2,
  }),
];

describe('the client list', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useLanguage('en');
  });

  it('shows what needs attention, not just names', async () => {
    // A list that only names things makes somebody open every row to find out
    // where the problem is.
    show(THREE);

    expect(await screen.findByText('1 needs attention')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens the client that was clicked', async () => {
    const user = userEvent.setup();
    const onOpen = show(THREE);

    await user.click(await screen.findByRole('button', { name: 'Marina Contracting LLC' }));

    expect(onOpen).toHaveBeenCalledWith('c-2');
  });

  it('searches the name', async () => {
    const user = userEvent.setup();
    show(THREE);

    await user.type(await screen.findByLabelText('Search'), 'marina');

    expect(screen.getByText('Marina Contracting LLC')).toBeInTheDocument();
    expect(screen.queryByText('Gulf Trading LLC')).not.toBeInTheDocument();
  });

  it('searches the tax number too, because that is often what is in front of you', async () => {
    const user = userEvent.setup();
    show(THREE);

    // A fragment unique to one of them. The three demo numbers share long
    // runs of digits, which is realistic and was my fixture's mistake, not
    // the search's.
    await user.type(await screen.findByLabelText('Search'), '6789');

    expect(screen.getByText('Noor Medical Supplies FZE')).toBeInTheDocument();
    expect(screen.queryByText('Marina Contracting LLC')).not.toBeInTheDocument();
  });

  it('searches the Arabic name as readily as the English one', async () => {
    const user = userEvent.setup();
    show([client({ legalNameArabic: 'الخليج للتجارة' })]);

    await user.type(await screen.findByLabelText('Search'), 'الخليج');

    expect(screen.getByRole('button', { name: /الخليج/ })).toBeInTheDocument();
  });

  it('narrows to the clients with a document needing attention', async () => {
    const user = userEvent.setup();
    show(THREE);

    await user.selectOptions(await screen.findByLabelText('Showing'), 'documents');

    expect(screen.getByText('Marina Contracting LLC')).toBeInTheDocument();
    expect(screen.queryByText('Gulf Trading LLC')).not.toBeInTheDocument();
    expect(screen.queryByText('Noor Medical Supplies FZE')).not.toBeInTheDocument();
  });

  it('narrows to the clients with open work', async () => {
    const user = userEvent.setup();
    show(THREE);

    await user.selectOptions(await screen.findByLabelText('Showing'), 'work');

    expect(screen.getByText('Noor Medical Supplies FZE')).toBeInTheDocument();
    expect(screen.queryByText('Marina Contracting LLC')).not.toBeInTheDocument();
  });

  it('says nothing matches rather than showing an empty table', async () => {
    const user = userEvent.setup();
    show(THREE);

    await user.type(await screen.findByLabelText('Search'), 'nobody by that name');

    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
    expect(screen.getByText('Try another name, or clear the filter.')).toBeInTheDocument();
  });

  it('says the firm has no clients rather than that nothing matches', async () => {
    // Different problems. One is a filter to clear and the other is a client
    // to add, and telling somebody the wrong one wastes their time.
    show([]);
    expect(await screen.findByText('No clients yet')).toBeInTheDocument();
  });

  it('switches to the enquiries without leaving the section', async () => {
    const user = userEvent.setup();
    show(THREE);

    await user.click(await screen.findByRole('button', { name: 'Enquiries' }));

    expect(await screen.findByText('No enquiries')).toBeInTheDocument();
    expect(screen.queryByText('Gulf Trading LLC')).not.toBeInTheDocument();
  });
});
