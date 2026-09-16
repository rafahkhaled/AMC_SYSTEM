import type { CalendarEntry, CalendarMonth } from '@amc/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { shiftMonth } from './api.js';
import { CalendarPage } from './calendar-page.js';

const calendarMonth = vi.hoisted(() => vi.fn());
vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return { ...actual, calendarMonth };
});

function entry(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: 'e-1',
    kind: 'vat_return',
    clientId: 'c-1',
    clientName: 'Gulf Trading LLC',
    subject: 'vat_return',
    periodKey: '2026-Q3',
    dueOn: '2026-09-28',
    statutoryOn: null,
    movedBecause: null,
    isOverdue: false,
    isDone: false,
    taskId: 't-1',
    ...over,
  };
}

/** September 2026: 30 days, the first of which is a Tuesday. */
function month(entries: CalendarEntry[] = [], overdue: CalendarEntry[] = []): CalendarMonth {
  return {
    month: '2026-09',
    days: Array.from({ length: 30 }, (_, index) => {
      const date = `2026-09-${String(index + 1).padStart(2, '0')}`;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        isWeekend: weekday === 0 || weekday === 6,
        holiday: null,
        entries: entries.filter((candidate) => candidate.dueOn === date),
      };
    }),
    overdue,
  };
}

function show(view: CalendarMonth, onOpenTask = vi.fn()) {
  calendarMonth.mockResolvedValue(view);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<CalendarPage onOpenTask={onOpenTask} />, { wrapper: Wrapper });
  return onOpenTask;
}

describe('the month ahead', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  it('says why a date moved, so the client can be told', async () => {
    // "The 21st, because the 20th was a weekend" is a sentence somebody can
    // repeat to a client. A bare date invites the question.
    show(
      month([entry({ dueOn: '2026-09-21', statutoryOn: '2026-09-20', movedBecause: 'weekend' })]),
    );

    expect(await screen.findByText('moved from 2026-09-20, a weekend')).toBeInTheDocument();
  });

  it('separates what is already late from what is merely due', async () => {
    show(month([entry()], [entry({ id: 'late', dueOn: '2026-07-28', isOverdue: true })]));

    expect(await screen.findByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('2026-07-28')).toHaveClass('u-danger');
  });

  it('shows no overdue section when nothing is late', async () => {
    show(month([entry()]));
    await screen.findByText('Gulf Trading LLC');
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('opens the task behind an entry', async () => {
    const user = userEvent.setup();
    const onOpenTask = show(month([entry({ taskId: 'task-9' })]));

    await user.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    expect(onOpenTask).toHaveBeenCalledWith('task-9');
  });

  it('leaves a document expiry unclickable, because there is no task behind it', async () => {
    show(month([entry({ kind: 'document_expiry', subject: 'trade_licence', taskId: null })]));

    expect(await screen.findByText('Trade licence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gulf Trading LLC/ })).not.toBeInTheDocument();
  });

  it('moves a month at a time, and back to today', async () => {
    const user = userEvent.setup();
    show(month());

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(calendarMonth).toHaveBeenLastCalledWith('2026-10');

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(calendarMonth).toHaveBeenLastCalledWith('2026-09');
  });

  it('says the month is quiet rather than showing an empty grid with no explanation', async () => {
    show(month());
    expect(await screen.findByText('Nothing due this month')).toBeInTheDocument();
  });
});

describe('stepping between months', () => {
  it('rolls over the end of the year in both directions', async () => {
    // A month is not an index to add one to. December plus one is January of
    // the following year, and January minus one is the December before it.
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });
});
