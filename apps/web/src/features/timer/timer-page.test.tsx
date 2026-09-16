import type { TimerState } from '@amc/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { TimerPage } from './timer-page.js';

const timerState = vi.hoisted(() => vi.fn());
const stopTimer = vi.hoisted(() => vi.fn());
const holdTimer = vi.hoisted(() => vi.fn());
const resumeTimer = vi.hoisted(() => vi.fn());
const beat = vi.hoisted(() => vi.fn());
const replayPending = vi.hoisted(() => vi.fn());
const pendingCount = vi.hoisted(() => vi.fn());
const timesheet = vi.hoisted(() => vi.fn());
vi.mock('./api.js', async () => {
  // The real module is kept for PendingSync, which the screen compares
  // against with instanceof: a mocked class is a different class, and the
  // check would silently never match.
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return {
    ...actual,
    timerState,
    stopTimer,
    holdTimer,
    resumeTimer,
    beat,
    startTimer: vi.fn(),
    replayPending,
    pendingCount,
    recordManual: vi.fn(),
    timesheet,
  };
});

const empty: TimerState = { running: null, today: [], todaySeconds: 0, todayBillableSeconds: 0 };

function entry(over: Partial<TimerState['today'][number]> = {}): TimerState['today'][number] {
  return {
    id: 'e1',
    taskId: 't1',
    clientName: 'Gulf Trading LLC',
    service: 'vat_return',
    startedAt: '2026-09-16T06:00:00.000Z',
    endedAt: '2026-09-16T06:40:00.000Z',
    seconds: 2400,
    billable: true,
    source: 'timer',
    locked: false,
    ...over,
  };
}

function running(over: Partial<NonNullable<TimerState['running']>> = {}) {
  return {
    taskId: 't1',
    assignmentId: 'a1',
    clientId: 'c1',
    clientName: 'Gulf Trading LLC',
    service: 'vat_return',
    startedAt: '2026-09-16T06:00:00.000Z',
    elapsedSeconds: 60,
    held: false,
    todayOnTaskSeconds: 60,
    ...over,
  };
}

function show(state: TimerState) {
  timerState.mockResolvedValue(state);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<TimerPage />, { wrapper: Wrapper });
}

describe('the timer screen', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    replayPending.mockResolvedValue({ sent: 0, remaining: 0, state: null });
    pendingCount.mockResolvedValue(0);
    // Given a value rather than left undefined: an unresolved query prints a
    // warning on every test, and warnings nobody reads hide the ones that matter.
    timesheet.mockResolvedValue({
      from: '2026-09-10',
      to: '2026-09-16',
      days: [],
      totalSeconds: 0,
      billableSeconds: 0,
      entries: [],
    });
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says plainly that nothing is running, and where to start one', async () => {
    show(empty);
    expect(await screen.findByText('No timer running')).toBeInTheDocument();
    expect(screen.getByText('Start the timer from a task in a client file.')).toBeInTheDocument();
  });

  it('reads the running timer as a clock, starting from the server count', async () => {
    show({ ...empty, running: running({ elapsedSeconds: 3725 }) });

    // Not 0:00:00. A tab opened onto a timer already running has to show the
    // hour the server has counted, not the second the component mounted.
    expect(await screen.findByText('1:02:05')).toBeInTheDocument();
    expect(screen.getByText('Gulf Trading LLC')).toBeInTheDocument();
  });

  it('never shows a recorded span as 0:00', async () => {
    // Rows reading 0:00 above a non-zero total look like broken arithmetic to
    // the one profession least willing to overlook it.
    show({ ...empty, today: [entry({ seconds: 45 })], todaySeconds: 45, todayBillableSeconds: 45 });

    // The row and the total both say it. A total of 0:00 above a row that
    // recorded something is the same lie told one line lower down.
    expect(await screen.findAllByText('under a minute')).toHaveLength(2);
    expect(screen.queryByText('0:00')).not.toBeInTheDocument();
  });

  it('shows a longer span in hours and minutes', async () => {
    show({ ...empty, today: [entry()], todaySeconds: 2400, todayBillableSeconds: 2400 });
    expect(await screen.findAllByText('0:40')).not.toHaveLength(0);
  });

  it('marks what will not be billed, so it is obvious before the invoice', async () => {
    show({
      ...empty,
      today: [entry({ billable: false, source: 'manual' }), entry({ id: 'e2', locked: true })],
      todaySeconds: 4800,
      todayBillableSeconds: 2400,
    });

    expect(await screen.findByText('Non-billable')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('Billed')).toBeInTheDocument();
  });

  it('stops through the server and shows what the server returns', async () => {
    const user = userEvent.setup();
    show({ ...empty, running: running() });
    stopTimer.mockResolvedValue({
      ...empty,
      today: [entry({ seconds: 60 })],
      todaySeconds: 60,
      todayBillableSeconds: 60,
    });

    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(stopTimer).toHaveBeenCalledOnce();
    expect(await screen.findByText('No timer running')).toBeInTheDocument();
  });

  it('says an action is kept on the device rather than reporting a failure', async () => {
    /*
     * A person taps stop and the train goes into a tunnel. The hour is written
     * down before the network is attempted, so the honest thing to say is that
     * it is kept — not that it did not work.
     */
    pendingCount.mockResolvedValue(1);
    show({ ...empty, running: running() });

    expect(
      await screen.findByText(
        'One action is kept on this device and will be sent when the connection returns.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing when the queue is empty', async () => {
    show({ ...empty, running: running() });
    await screen.findByRole('button', { name: 'Stop' });
    expect(screen.queryByText(/kept on this device/)).not.toBeInTheDocument();
  });

  it('offers a hold while running, and a resume once held', async () => {
    const user = userEvent.setup();
    show({ ...empty, running: running() });
    holdTimer.mockResolvedValue({
      ...empty,
      running: running({ held: true, elapsedSeconds: 0, todayOnTaskSeconds: 2400 }),
      today: [entry({ seconds: 2400 })],
      todaySeconds: 2400,
      todayBillableSeconds: 2400,
    });

    await user.click(await screen.findByRole('button', { name: 'Hold' }));

    expect(holdTimer).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold' })).not.toBeInTheDocument();
    expect(screen.getByText('Held')).toBeInTheDocument();
    // Still on the task, which is the whole difference between this and stop.
    // Twice: once in the held panel, once in the entry the hold just recorded.
    expect(screen.getAllByText('Gulf Trading LLC')).toHaveLength(2);
  });

  it('shows the day on the task while held, not a clock counting the pause', async () => {
    show({
      ...empty,
      running: running({ held: true, elapsedSeconds: 0, todayOnTaskSeconds: 5400 }),
    });

    expect(await screen.findByText('1:30')).toBeInTheDocument();
    expect(screen.getByText('today on this task')).toBeInTheDocument();
    // A running clock reads h:mm:ss. Nothing on a held screen should.
    expect(screen.queryByText(/^\d+:\d\d:\d\d$/)).not.toBeInTheDocument();
  });

  it('sends no heartbeat while held, because nothing is being counted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show({ ...empty, running: running({ held: true, elapsedSeconds: 0 }) });
    await screen.findByRole('button', { name: 'Resume' });

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(beat).not.toHaveBeenCalled();
  });

  it('resumes through the server', async () => {
    const user = userEvent.setup();
    show({ ...empty, running: running({ held: true, elapsedSeconds: 0 }) });
    resumeTimer.mockResolvedValue({ ...empty, running: running({ elapsedSeconds: 0 }) });

    await user.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(resumeTimer).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Hold' })).toBeInTheDocument();
  });
});
