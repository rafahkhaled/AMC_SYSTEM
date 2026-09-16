import type { BoardTask, TaskBoard } from '@amc/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { TasksPage } from './tasks-page.js';

const taskBoard = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  taskBoard,
  taskDetail: vi.fn(),
  moveTask: vi.fn(),
  completeStep: vi.fn(),
  attachDocument: vi.fn(),
}));

function card(over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'task-1',
    clientId: 'c1',
    clientName: 'Gulf Trading LLC',
    service: 'vat_return',
    periodKey: '2026-Q3',
    state: 'ready',
    dueAt: '2026-10-28T00:00:00.000Z',
    isOverdue: false,
    missingDocuments: [],
    assignees: [],
    recordedSeconds: 0,
    ...over,
  };
}

function board(tasks: Record<string, BoardTask[]> = {}): TaskBoard {
  const states = [
    'awaiting_documents',
    'ready',
    'in_progress',
    'waiting_for_client',
    'waiting_for_authority',
  ] as const;
  return { columns: states.map((state) => ({ state, tasks: tasks[state] ?? [] })) };
}

function show(data: TaskBoard, onOpen = vi.fn()) {
  taskBoard.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TasksPage onOpen={onOpen} />, { wrapper: Wrapper });
  return onOpen;
}

describe('the board', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  it('shows the columns the server sent, in the order it sent them', async () => {
    // The lifecycle belongs to the domain. A screen that ordered these itself
    // would be a second account of it, free to drift.
    show(board({ ready: [card()] }));

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Awaiting documents',
      'Ready',
      'In progress',
      'Waiting for client',
      'Waiting for authority',
    ]);
  });

  it('separates waiting for the client from waiting for the authority', async () => {
    // One is chased by the practice, the other cannot be hurried. A board that
    // merged them would tell a manager nothing about what is stuck on our side.
    show(
      board({
        waiting_for_client: [card({ id: 'a', state: 'waiting_for_client' })],
        waiting_for_authority: [
          card({ id: 'b', state: 'waiting_for_authority', clientName: 'Marina Contracting LLC' }),
        ],
      }),
    );

    expect(await screen.findByText('Gulf Trading LLC')).toBeInTheDocument();
    expect(screen.getByText('Marina Contracting LLC')).toBeInTheDocument();
  });

  it('says nothing is here rather than leaving a column blank', async () => {
    show(board({ ready: [card()] }));
    expect((await screen.findAllByText('Nothing here')).length).toBe(4);
  });

  it('marks an overdue date and a missing document', async () => {
    show(board({ ready: [card({ isOverdue: true, missingDocuments: ['vat_certificate'] })] }));

    expect(await screen.findByText('1 document missing')).toBeInTheDocument();
    expect(screen.getByText('2026-10-28')).toHaveClass('u-danger');
  });

  it('never reports a recorded span as 0:00', async () => {
    show(board({ ready: [card({ recordedSeconds: 45 })] }));
    expect(await screen.findByText('under a minute recorded')).toBeInTheDocument();
  });

  it('says who is on it, or that nobody is', async () => {
    show(
      board({
        ready: [
          card({ assignees: [{ userId: 'u1', displayName: 'Wael Ajam', role: 'responsible' }] }),
          card({ id: 'task-2', clientName: 'Noor Medical Supplies FZE' }),
        ],
      }),
    );

    expect(await screen.findByText('Wael Ajam')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('opens the task that was clicked', async () => {
    const user = userEvent.setup();
    const onOpen = show(board({ ready: [card({ id: 'the-one' })] }));

    await user.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    expect(onOpen).toHaveBeenCalledWith('the-one');
  });

  it('says the board is empty when there is no open work at all', async () => {
    show(board());
    expect(await screen.findByText('No open work')).toBeInTheDocument();
  });
});
