import type { InvoiceView, StatementView } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { BillingPage } from './billing-page.js';

const statements = vi.hoisted(() => vi.fn());
const statement = vi.hoisted(() => vi.fn());
const generate = vi.hoisted(() => vi.fn());
const reviseLine = vi.hoisted(() => vi.fn());
const approve = vi.hoisted(() => vi.fn());
const raiseInvoice = vi.hoisted(() => vi.fn());
const invoices = vi.hoisted(() => vi.fn());
const recordPayment = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  statements,
  statement,
  generate,
  reviseLine,
  approve,
  raiseInvoice,
  invoices,
  recordPayment,
}));

const aed = (minorUnits: number) => ({ minorUnits, currency: 'AED' });

function line(over: Partial<StatementView['lines'][number]> = {}): StatementView['lines'][number] {
  return {
    id: 'sl-1',
    taskId: 't-1',
    service: 'vat_return',
    performedOn: '2026-09-03',
    userId: 'u-1',
    userName: 'Hana Saeed',
    workedSeconds: 7200,
    perHour: aed(30_000),
    asWorked: aed(60_000),
    amount: aed(60_000),
    excluded: false,
    excludedReason: null,
    adjustedTo: null,
    adjustedReason: null,
    ...over,
  };
}

function statementOf(over: Partial<StatementView> = {}): StatementView {
  const lines = over.lines ?? [line()];
  return {
    id: 's-1',
    clientId: 'c-1',
    clientName: 'Gulf Trading LLC',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    state: 'draft',
    currency: 'AED',
    lines,
    totalAsWorked: aed(60_000),
    total: aed(60_000),
    workedSeconds: 7200,
    approvedAt: null,
    approvedBy: null,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...over,
  };
}

function invoiceOf(over: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: 'inv-1',
    clientId: 'c-1',
    clientName: 'Gulf Trading LLC',
    statementId: 's-1',
    number: 'INV-2026-0001',
    status: 'issued',
    settlement: 'issued',
    currency: 'AED',
    lines: [
      {
        id: 'il-1',
        taskId: 't-1',
        service: 'vat_return',
        descriptionEn: 'VAT return — September 2026',
        descriptionAr: 'الإقرار الضريبي — سبتمبر ٢٠٢٦',
        workedSeconds: 7200,
        amount: aed(60_000),
      },
    ],
    payments: [],
    vatBasisPoints: 500,
    net: aed(60_000),
    vat: aed(3_000),
    total: aed(63_000),
    paid: aed(0),
    balance: aed(63_000),
    issuedOn: '2026-10-01T08:00:00.000Z',
    dueOn: '2026-10-31T08:00:00.000Z',
    overdueSince: null,
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  statements.mockResolvedValue([statementOf()]);
  statement.mockResolvedValue(statementOf());
  invoices.mockResolvedValue([invoiceOf()]);
});

describe('the statement list', () => {
  it('names the client and shows what will be billed', async () => {
    renderScreen(<BillingPage />);
    expect(await screen.findByText('Gulf Trading LLC')).toBeInTheDocument();
    expect(screen.getByText(/2026-09-01/)).toBeInTheDocument();
  });

  it('says so when there is nothing yet', async () => {
    statements.mockResolvedValue([]);
    renderScreen(<BillingPage />);
    expect(await screen.findByText('No statements yet')).toBeInTheDocument();
  });

  it('reports a failure rather than an empty list', async () => {
    statements.mockRejectedValue(new Error('nope'));
    renderScreen(<BillingPage />);
    expect(await screen.findByText('The billing data could not be loaded.')).toBeInTheDocument();
  });
});

describe('reviewing a statement', () => {
  it('shows each line with who did it and at what rate', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    // Scoped to the line: the hours also appear in the totals row above, and
    // an unscoped query matches both and throws.
    const detail = await screen.findByText(/Hana Saeed/);
    expect(detail).toHaveTextContent('2.00h');
    expect(detail).toHaveTextContent('2026-09-03');
  });

  it('hides "as worked" while nothing has been changed', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await screen.findByText('To bill');

    // Two identical figures side by side teach a reviewer to stop reading
    // both. It appears only once there is a gap.
    expect(screen.queryByText('As worked')).not.toBeInTheDocument();
  });

  it('shows "as worked" beside "to bill" once a line has been written down', async () => {
    statement.mockResolvedValue(
      statementOf({
        lines: [line({ excluded: true, excludedReason: 'goodwill', amount: aed(0) })],
        total: aed(0),
        totalAsWorked: aed(60_000),
      }),
    );

    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    expect(await screen.findByText('As worked')).toBeInTheDocument();
    expect(screen.getByText('To bill')).toBeInTheDocument();
    expect(screen.getByText(/Excluded because/)).toBeInTheDocument();
  });

  it('will not revise a line without a reason', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revise' }));

    // The reason is what makes "why is this not what the timesheet says"
    // answerable six months later.
    expect(screen.getByRole('button', { name: 'Exclude line' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Reason'), 'written off, goodwill');
    expect(screen.getByRole('button', { name: 'Exclude line' })).toBeEnabled();
  });

  it('excludes a line when no amount is given', async () => {
    reviseLine.mockResolvedValue(statementOf({ total: aed(0) }));

    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revise' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'written off, goodwill');
    await userEvent.click(screen.getByRole('button', { name: 'Exclude line' }));

    await waitFor(() =>
      expect(reviseLine).toHaveBeenCalledWith('s-1', 'sl-1', {
        reason: 'written off, goodwill',
      }),
    );
  });

  it('adjusts to the amount typed, in whole fils', async () => {
    reviseLine.mockResolvedValue(statementOf());

    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revise' }));
    await userEvent.type(screen.getByLabelText('New amount'), '500.50');
    await userEvent.type(screen.getByLabelText('Reason'), 'agreed with Layla');

    expect(screen.getByRole('button', { name: 'Adjust amount' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Adjust amount' }));

    await waitFor(() =>
      expect(reviseLine).toHaveBeenCalledWith('s-1', 'sl-1', {
        reason: 'agreed with Layla',
        adjustToMinor: 50_050,
      }),
    );
  });

  it('refuses an amount that is not one', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revise' }));
    await userEvent.type(screen.getByLabelText('New amount'), '1.234');
    await userEvent.type(screen.getByLabelText('Reason'), 'agreed with Layla');

    // Three decimal places is not fils, and rounding it silently would bill a
    // figure nobody typed.
    expect(await screen.findByText(/Enter an amount/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adjust amount' })).toBeDisabled();
  });

  it('offers approve on a draft and invoice on an approved one', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    expect(await screen.findByRole('button', { name: 'Approve statement' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });

  it('offers only invoice once approved, and no revising', async () => {
    statement.mockResolvedValue(statementOf({ state: 'approved', approvedBy: 'Wael Ajam' }));

    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    expect(await screen.findByRole('button', { name: 'Raise invoice' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve statement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revise' })).not.toBeInTheDocument();
  });

  it('shows what the server said when it refuses', async () => {
    approve.mockRejectedValue(new Error('Every line has been excluded'));

    renderScreen(<BillingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve statement' }));

    expect(await screen.findByText(/Every line has been excluded/)).toBeInTheDocument();
  });
});

describe('invoices', () => {
  it('lists them with what is still owing', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invoices' }));

    expect(await screen.findByText('INV-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
  });

  it('shows the VAT breakdown, which a UAE client checks', async () => {
    renderScreen(<BillingPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    await userEvent.click(await screen.findByRole('button', { name: /INV-2026-0001/ }));

    expect(await screen.findByText('Net')).toBeInTheDocument();
    expect(screen.getByText('VAT')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('records a payment in whole fils', async () => {
    recordPayment.mockResolvedValue(invoiceOf({ status: 'part_paid', balance: aed(43_000) }));

    renderScreen(<BillingPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    await userEvent.click(await screen.findByRole('button', { name: /INV-2026-0001/ }));

    await userEvent.type(await screen.findByLabelText('Amount received'), '200.00');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(recordPayment).toHaveBeenCalled());
    expect(recordPayment.mock.calls[0]?.[1]).toMatchObject({
      amountMinor: 20_000,
      method: 'bank_transfer',
    });
  });

  it('offers no payment box once it is settled', async () => {
    invoices.mockResolvedValue([invoiceOf({ status: 'paid', paid: aed(63_000), balance: aed(0) })]);

    renderScreen(<BillingPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    await userEvent.click(await screen.findByRole('button', { name: /INV-2026-0001/ }));

    await screen.findByText('Net');
    expect(screen.queryByLabelText('Amount received')).not.toBeInTheDocument();
  });

  it('says when an invoice went late, not merely that it is', async () => {
    invoices.mockResolvedValue([
      invoiceOf({ status: 'overdue', overdueSince: '2026-11-01T00:00:00.000Z' }),
    ]);

    renderScreen(<BillingPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    await userEvent.click(await screen.findByRole('button', { name: /INV-2026-0001/ }));

    // The follow-up ladder counts from that day, so the screen shows it.
    expect(await screen.findByText(/Overdue since 2026-11-01/)).toBeInTheDocument();
  });
});

describe('in Arabic', () => {
  it('reads right through', async () => {
    await useLanguage('ar');
    renderScreen(<BillingPage />);
    // The words appear on the tab and on the card, so match the one that is
    // a tab rather than asserting there is only one.
    expect(await screen.findByRole('button', { name: 'كشوف الأعمال' })).toBeInTheDocument();
    expect(await screen.findByText(/مسعّرة بسعر اليوم/)).toBeInTheDocument();
  });
});
