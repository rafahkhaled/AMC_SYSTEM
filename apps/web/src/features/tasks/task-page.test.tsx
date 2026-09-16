import type { TaskDetail } from '@amc/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { TaskPage } from './task-page.js';

const taskDetail = vi.hoisted(() => vi.fn());
const moveTask = vi.hoisted(() => vi.fn());
const completeStep = vi.hoisted(() => vi.fn());
const attachDocument = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  taskDetail,
  moveTask,
  completeStep,
  attachDocument,
  taskBoard: vi.fn(),
}));
vi.mock('../timer/timer-page.js', () => ({
  StartTimerButton: () => <button type="button">Start</button>,
}));

function detail(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 'task-1',
    clientId: 'c1',
    clientName: 'Gulf Trading LLC',
    service: 'vat_return',
    periodKey: '2026-Q3',
    state: 'awaiting_documents',
    dueAt: '2026-10-28T00:00:00.000Z',
    isOverdue: false,
    missingDocuments: ['vat_certificate'],
    assignees: [],
    recordedSeconds: 0,
    requirements: [
      {
        type: 'vat_certificate',
        mandatory: true,
        documentId: null,
        documentName: null,
        documentExpiresOn: null,
      },
    ],
    steps: [
      {
        order: 1,
        titleEn: 'Request the period documents',
        titleAr: 'اطلب مستندات الفترة',
        doneAt: null,
      },
      { order: 2, titleEn: 'Reconcile the bank', titleAr: 'طابق البنك', doneAt: null },
    ],
    allowedTransitions: ['ready', 'cancelled'],
    availableDocuments: [],
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

function show(data: TaskDetail) {
  taskDetail.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TaskPage id="task-1" onBack={vi.fn()} />, { wrapper: Wrapper });
}

describe('one piece of work', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  it('offers only the moves the domain allows', async () => {
    // The buttons come from the server's reading of the transition table, so
    // the screen can never offer a move that would be refused.
    show(detail());

    expect(await screen.findByRole('button', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In progress' })).not.toBeInTheDocument();
  });

  it('says so when the work is finished, rather than showing no buttons', async () => {
    show(detail({ state: 'completed', allowedTransitions: [] }));
    expect(
      await screen.findByText('This work is finished. Anything after it is new work.'),
    ).toBeInTheDocument();
  });

  it('shows the refusal when a move is rejected', async () => {
    const user = userEvent.setup();
    show(detail());
    moveTask.mockRejectedValue(new Error('The documents this work needs are not all here yet'));

    await user.click(await screen.findByRole('button', { name: 'Ready' }));

    expect(
      await screen.findByText('The documents this work needs are not all here yet'),
    ).toBeInTheDocument();
  });

  it('says when the client holds nothing that would satisfy a requirement', async () => {
    // Without this the row would simply have no control on it, and a person
    // would be left wondering whether the screen had failed to load.
    show(detail());

    expect(await screen.findByText('Not on file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach the one held' })).not.toBeInTheDocument();
  });

  it('attaches the document the client actually holds', async () => {
    const user = userEvent.setup();
    show(
      detail({
        availableDocuments: [{ id: 'doc-9', type: 'vat_certificate', expiresOn: null }],
      }),
    );
    attachDocument.mockResolvedValue(detail());

    await user.click(await screen.findByRole('button', { name: 'Attach the one held' }));

    expect(attachDocument).toHaveBeenCalledWith('task-1', 'vat_certificate', 'doc-9');
  });

  it('marks a step done and shows when an already-done one was finished', async () => {
    const user = userEvent.setup();
    show(
      detail({
        steps: [
          {
            order: 1,
            titleEn: 'Request the period documents',
            titleAr: 'ا',
            doneAt: '2026-09-14T00:00:00.000Z',
          },
          { order: 2, titleEn: 'Reconcile the bank', titleAr: 'ب', doneAt: null },
        ],
      }),
    );
    completeStep.mockResolvedValue(detail());

    expect(await screen.findByText('2026-09-14')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(completeStep).toHaveBeenCalledWith('task-1', 2);
  });

  it('will not let a blocked task be started, and says what is missing', async () => {
    // The lifecycle allows ready to start; this one's paperwork does not.
    // Learning that by pressing the button and reading a refusal is worse
    // than being told before pressing it.
    show(
      detail({
        state: 'ready',
        allowedTransitions: ['in_progress', 'awaiting_documents', 'cancelled'],
        missingDocuments: ['vat_certificate'],
      }),
    );

    const start = await screen.findByRole('button', { name: 'In progress' });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('title', 'Cannot start until these arrive: VAT certificate');
  });

  it('lets a task with its paperwork in order start', async () => {
    show(
      detail({
        state: 'ready',
        allowedTransitions: ['in_progress', 'cancelled'],
        missingDocuments: [],
      }),
    );

    expect(await screen.findByRole('button', { name: 'In progress' })).toBeEnabled();
  });

  it('only offers the timer once the work has actually started', async () => {
    show(detail({ state: 'ready', allowedTransitions: ['in_progress'] }));
    await screen.findByRole('button', { name: 'In progress' });
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });
});
