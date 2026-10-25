import type { Classification, Salesperson } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ClassificationPanel } from './classification-panel.js';

const classificationOf = vi.hoisted(() => vi.fn());
const changeClassification = vi.hoisted(() => vi.fn());
const listSalespeople = vi.hoisted(() => vi.fn());
const addSalesperson = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  classificationOf,
  changeClassification,
  listSalespeople,
  addSalesperson,
}));

const listBranches = vi.hoisted(() => vi.fn());
vi.mock('../branches/api.js', () => ({ listBranches }));

const PEOPLE: Salesperson[] = [
  { id: 'sp-u1', name: 'Hana Saeed', userId: 'u1', retired: false },
  { id: 'sp-x', name: 'Omar the agent', userId: null, retired: false },
  { id: 'sp-old', name: 'Gone Away', userId: null, retired: true },
];
const value = (over: Partial<Classification> = {}): Classification => ({
  branchCode: 'ajman',
  salespersonId: 'sp-x',
  performedBy: 'u1',
  branchEditable: true,
  performerEditable: true,
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  listSalespeople.mockResolvedValue(PEOPLE);
  listBranches.mockResolvedValue([
    {
      code: 'dubai',
      nameEn: 'Dubai Branch',
      nameAr: 'فرع دبي',
      retired: false,
      addresses: [],
      bank: null,
      logoUrl: null,
      stampUrl: null,
    },
    {
      code: 'ajman',
      nameEn: 'Ajman Branch',
      nameAr: 'فرع عجمان',
      retired: false,
      addresses: [],
      bank: null,
      logoUrl: null,
      stampUrl: null,
    },
  ]);
  classificationOf.mockResolvedValue(value());
});

const options = (label: string) =>
  [...screen.getByLabelText(label).querySelectorAll('option')].map((option) => option.textContent);

describe('branch, salesperson and who did the work', () => {
  it('shows what this record has', async () => {
    renderScreen(<ClassificationPanel entity="client" id="c-1" canEdit />);

    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('ajman'));
    await waitFor(() => expect(screen.getByLabelText('Salesperson')).toHaveValue('sp-x'));
    expect(screen.getByLabelText('Who did the work')).toHaveValue('u1');
  });

  it('offers employees and outside agents as salespeople, but only employees as the performer', async () => {
    renderScreen(<ClassificationPanel entity="client" id="c-1" canEdit />);
    await waitFor(() => expect(options('Salesperson')).toContain('Omar the agent'));

    expect(options('Salesperson')).toContain('Hana Saeed');
    expect(options('Salesperson')).not.toContain('Gone Away');
    expect(options('Who did the work')).toEqual(['Not set', 'Hana Saeed']);
  });

  it('saves a change as soon as it is chosen', async () => {
    const user = userEvent.setup();
    changeClassification.mockResolvedValue(value({ branchCode: 'dubai' }));
    renderScreen(<ClassificationPanel entity="project" id="p-1" canEdit />);

    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('ajman'));
    await user.selectOptions(screen.getByLabelText('Branch'), 'dubai');

    expect(changeClassification).toHaveBeenCalledWith('project', 'p-1', { branchCode: 'dubai' });
  });

  it('adds a new salesperson from the box itself, and picks them', async () => {
    const user = userEvent.setup();
    addSalesperson.mockResolvedValue({
      id: 'sp-new',
      salespeople: [
        ...PEOPLE,
        { id: 'sp-new', name: 'Layla Broker', userId: null, retired: false },
      ],
    });
    changeClassification.mockResolvedValue(value({ salespersonId: 'sp-new' }));
    renderScreen(<ClassificationPanel entity="quotation" id="q-1" canEdit />);

    await waitFor(() => expect(options('Salesperson')).toContain('+ Add a new salesperson…'));
    await user.selectOptions(screen.getByLabelText('Salesperson'), '__add__');
    await user.type(screen.getByLabelText('New salesperson’s name'), 'Layla Broker');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addSalesperson).toHaveBeenCalledWith('Layla Broker'));
    expect(changeClassification).toHaveBeenCalledWith('quotation', 'q-1', {
      salespersonId: 'sp-new',
    });
  });

  it('hides the branch where it is set on the document, and the performer on a job', async () => {
    classificationOf.mockResolvedValue(value({ branchEditable: false, performerEditable: false }));
    renderScreen(<ClassificationPanel entity="invoice" id="i-1" canEdit />);

    await screen.findByLabelText('Salesperson');
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(screen.queryByLabelText('Who did the work')).toBeNull();
  });

  it('cannot be changed by somebody who may not edit it', async () => {
    renderScreen(<ClassificationPanel entity="client" id="c-1" canEdit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Salesperson')).toBeDisabled());
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    changeClassification.mockRejectedValue(new Error('That is not one of the firm’s branches'));
    renderScreen(<ClassificationPanel entity="client" id="c-1" canEdit />);

    await waitFor(() => expect(screen.getByLabelText('Branch')).toHaveValue('ajman'));
    await user.selectOptions(screen.getByLabelText('Branch'), 'dubai');
    expect(await screen.findByText('That is not one of the firm’s branches')).toBeInTheDocument();
  });
});
