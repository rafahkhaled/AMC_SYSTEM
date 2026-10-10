import type { ProjectDetail } from '@amc/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { ProjectPage } from './project-page.js';

const projectDetail = vi.hoisted(() => vi.fn());
const moveProject = vi.hoisted(() => vi.fn());
const completeTask = vi.hoisted(() => vi.fn());
const attachDocument = vi.hoisted(() => vi.fn());
const openNextProject = vi.hoisted(() => vi.fn());
const stopRepeating = vi.hoisted(() => vi.fn());
const resumeRepeating = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  projectDetail,
  moveProject,
  completeTask,
  attachDocument,
  openNextProject,
  stopRepeating,
  resumeRepeating,
  projectBoard: vi.fn(),
}));
vi.mock('../timer/timer-page.js', () => ({
  StartTimerButton: () => <button type="button">Start</button>,
}));

function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'project-1',
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
    tasks: [
      {
        order: 1,
        titleEn: 'Request the period documents',
        titleAr: 'اطلب مستندات الفترة',
        dueOn: null,
        doneAt: null,
      },
      { order: 2, titleEn: 'Reconcile the bank', titleAr: 'طابق البنك', dueOn: null, doneAt: null },
    ],
    allowedTransitions: ['ready', 'cancelled'],
    backwardTransitions: [],
    continuation: null,
    availableDocuments: [],
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

function show(data: ProjectDetail, onOpen: (id: string) => void = vi.fn()) {
  projectDetail.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<ProjectPage id="project-1" onBack={vi.fn()} onOpen={onOpen} />, { wrapper: Wrapper });
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
    moveProject.mockRejectedValue(new Error('The documents this work needs are not all here yet'));

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

    expect(attachDocument).toHaveBeenCalledWith('project-1', 'vat_certificate', 'doc-9');
  });

  it('marks a task done and shows when an already-done one was finished', async () => {
    const user = userEvent.setup();
    show(
      detail({
        tasks: [
          {
            order: 1,
            titleEn: 'Request the period documents',
            titleAr: 'ا',
            dueOn: null,
            doneAt: '2026-09-14T00:00:00.000Z',
          },
          { order: 2, titleEn: 'Reconcile the bank', titleAr: 'ب', dueOn: null, doneAt: null },
        ],
      }),
    );
    completeTask.mockResolvedValue(detail());

    expect(await screen.findByText('2026-09-14')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(completeTask).toHaveBeenCalledWith('project-1', 2);
  });

  it('will not let a blocked project be started, and says what is missing', async () => {
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

  it('lets a project with its paperwork in order start', async () => {
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

/*
 * What happens after a recurring job is finished (feedback item 9).
 *
 * The sweep opens work for the period that has just closed, on its own. The
 * person finishing a job decides the other half: carry straight on with the
 * next, or say this was a one-off so it stops coming round.
 */
describe('after a recurring job is finished', () => {
  const finished = (repeating: boolean) =>
    detail({
      state: 'completed',
      allowedTransitions: [],
      missingDocuments: [],
      continuation: { repeating },
    });

  it('offers to open the next one, or to call it a one-time job', async () => {
    show(finished(true));

    expect(await screen.findByText('What happens after this one?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the next one' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'This was a one-time job' })).toBeVisible();
  });

  it('offers nothing while the job is still open, or for a service done once', async () => {
    show(detail({ continuation: null }));
    await screen.findByText('Gulf Trading LLC');
    expect(screen.queryByText('What happens after this one?')).not.toBeInTheDocument();
  });

  it('opens the next one and goes to it', async () => {
    openNextProject.mockResolvedValue(detail({ id: 'project-2', periodKey: '2026-Q4' }));
    const onOpen = vi.fn();
    show(finished(true), onOpen);

    await userEvent.click(await screen.findByRole('button', { name: 'Open the next one' }));

    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith('project-2'));
    expect(openNextProject).toHaveBeenCalledWith('project-1');
  });

  it('stops it repeating, and says so afterwards', async () => {
    stopRepeating.mockResolvedValue(finished(false));
    show(finished(true));

    await userEvent.click(await screen.findByRole('button', { name: 'This was a one-time job' }));

    expect(await screen.findByText(/no longer repeats for this client/)).toBeInTheDocument();
    expect(stopRepeating).toHaveBeenCalledWith('project-1');
    // The choice that was made is gone; the way back is not.
    expect(
      screen.queryByRole('button', { name: 'This was a one-time job' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start repeating again' })).toBeVisible();
  });

  it('can start repeating again after being stopped', async () => {
    resumeRepeating.mockResolvedValue(finished(true));
    show(finished(false));

    await userEvent.click(await screen.findByRole('button', { name: 'Start repeating again' }));

    await vi.waitFor(() => expect(resumeRepeating).toHaveBeenCalledWith('project-1'));
  });

  it('still lets them open the next one after stopping it repeating', async () => {
    // Opening the next period and having the sweep do it unprompted are
    // separate decisions; answering one does not take the other away.
    show(finished(false));
    expect(await screen.findByRole('button', { name: 'Open the next one' })).toBeVisible();
  });

  it('shows the server’s reason when it cannot open the next one', async () => {
    openNextProject.mockRejectedValue(new Error('2026-Q4 is already open for this client'));
    show(finished(true));

    await userEvent.click(await screen.findByRole('button', { name: 'Open the next one' }));

    expect(await screen.findByText('2026-Q4 is already open for this client')).toBeInTheDocument();
  });
});
