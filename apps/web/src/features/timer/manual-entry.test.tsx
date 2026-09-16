import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { ManualEntry } from './manual-entry.js';

const recordManual = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  recordManual,
  timerState: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  holdTimer: vi.fn(),
  resumeTimer: vi.fn(),
  beat: vi.fn(),
  timesheet: vi.fn(),
}));

const TASKS = [{ taskId: 't-1', label: 'Gulf Trading LLC — VAT return' }];

function show(onRecorded = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<ManualEntry tasks={TASKS} onRecorded={onRecorded} />, { wrapper: Wrapper });
  return onRecorded;
}

async function fillIn(
  user: ReturnType<typeof userEvent.setup>,
  over: Partial<Record<string, string>> = {},
) {
  await user.selectOptions(screen.getByLabelText('Task'), 't-1');
  await user.type(screen.getByLabelText('From'), over.from ?? '2026-09-14T14:00');
  await user.type(screen.getByLabelText('To'), over.to ?? '2026-09-14T15:45');
  if (over.reason !== '') {
    await user.type(screen.getByLabelText('Reason'), over.reason ?? 'Call with the client');
  }
}

describe('time recorded by hand (FR-22)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  it('will not record without a reason', async () => {
    /*
     * Required by the domain and by a database constraint too. Time typed in
     * afterwards is the part of a client statement most likely to be
     * questioned, and a blank field is not an answer.
     */
    const user = userEvent.setup();
    show();
    await fillIn(user, { reason: '' });

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });

  it('will not record a span that ends before it starts', async () => {
    const user = userEvent.setup();
    show();
    await fillIn(user, { from: '2026-09-14T15:45', to: '2026-09-14T14:00' });

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });

  it('will not record against no task', async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText('From'), '2026-09-14T14:00');
    await user.type(screen.getByLabelText('To'), '2026-09-14T15:45');
    await user.type(screen.getByLabelText('Reason'), 'Call with the client');

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });

  it('sends what was typed, billable unless told otherwise', async () => {
    const user = userEvent.setup();
    show();
    recordManual.mockResolvedValue({
      running: null,
      today: [],
      todaySeconds: 0,
      todayBillableSeconds: 0,
    });

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Record' }));

    expect(recordManual).toHaveBeenCalledWith({
      taskId: 't-1',
      startedAt: '2026-09-14T14:00',
      endedAt: '2026-09-14T15:45',
      reason: 'Call with the client',
      billable: true,
    });
  });

  it('confirms what was recorded and when, not what today looks like', async () => {
    /*
     * The entry may be for a past day, so the response describing today would
     * be unchanged. Confirming from what was submitted is the only way a
     * correct write does not look like nothing happening.
     */
    const user = userEvent.setup();
    show();
    recordManual.mockResolvedValue({
      running: null,
      today: [],
      todaySeconds: 0,
      todayBillableSeconds: 0,
    });

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText('Recorded 1:45 on 2026-09-14')).toBeInTheDocument();
  });

  it('shows the refusal the server gave', async () => {
    const user = userEvent.setup();
    show();
    recordManual.mockRejectedValue(new Error('Time cannot be recorded for work not yet done'));

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Record' }));

    expect(
      await screen.findByText('Time cannot be recorded for work not yet done'),
    ).toBeInTheDocument();
  });

  it('can mark time as not billable', async () => {
    const user = userEvent.setup();
    show();
    recordManual.mockResolvedValue({
      running: null,
      today: [],
      todaySeconds: 0,
      todayBillableSeconds: 0,
    });

    await fillIn(user);
    await user.click(screen.getByLabelText('Billable'));
    await user.click(screen.getByRole('button', { name: 'Record' }));

    expect(recordManual).toHaveBeenCalledWith(expect.objectContaining({ billable: false }));
  });
});
