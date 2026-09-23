import type { QuotationView } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { Quotations } from './quotations.js';

const quotations = vi.hoisted(() => vi.fn());
const addQuotationLine = vi.hoisted(() => vi.fn());
const removeQuotationLine = vi.hoisted(() => vi.fn());
const answerQuotation = vi.hoisted(() => vi.fn());
const firmProfile = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  quotations,
  addQuotationLine,
  removeQuotationLine,
  answerQuotation,
  draftQuotation: vi.fn(),
  firmProfile,
}));

const aed = (minorUnits: number) => ({ minorUnits, currency: 'AED' });

function quotationOf(over: Partial<QuotationView> = {}): QuotationView {
  return {
    id: 'q-1',
    clientId: 'c-1',
    clientName: 'Gulf Trading LLC',
    reference: 'Q-2026-014',
    state: 'draft',
    currency: 'AED',
    lines: [
      {
        id: 'ql-1',
        descriptionEn: 'VAT registration',
        descriptionAr: 'التسجيل الضريبي',
        kind: 'hours',
        hours: 3.5,
        perHour: aed(12_345),
        amount: aed(43_208),
      },
      {
        id: 'ql-2',
        descriptionEn: 'Annual audit',
        descriptionAr: 'التدقيق السنوي',
        kind: 'fixed',
        hours: null,
        perHour: null,
        amount: aed(500_000),
      },
    ],
    total: aed(543_208),
    validUntil: '2026-10-22',
    sentAt: null,
    sentVia: null,
    decidedAt: null,
    notesEn: null,
    notesAr: null,
    createdAt: '2026-09-22T08:00:00.000Z',
    ...over,
  };
}

function show() {
  renderScreen(<Quotations openId="q-1" onOpen={() => {}} />);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  quotations.mockResolvedValue([quotationOf()]);
});

describe('the quotation list', () => {
  it('shows the reference the client quotes back', async () => {
    show();
    expect(await screen.findAllByText('Q-2026-014')).not.toHaveLength(0);
    expect(screen.getAllByText('Gulf Trading LLC').length).toBeGreaterThan(0);
  });

  it('says nothing is there yet', async () => {
    quotations.mockResolvedValue([]);
    renderScreen(<Quotations openId={null} onOpen={() => {}} />);
    expect(await screen.findByText('No quotations yet')).toBeInTheDocument();
  });
});

describe('how a line was priced', () => {
  it('shows hours and the rate, not only the total', async () => {
    show();
    // A fixed fee accepted at 5,000 is still 5,000 when the work runs long,
    // and an hourly estimate is not. Which was offered has to stay visible.
    expect(await screen.findByText(/3\.5h at/)).toBeInTheDocument();
    expect(screen.getByText('Fixed fee')).toBeInTheDocument();
  });
});

describe('while it is a draft', () => {
  it('offers to send it, and not to answer for the client', async () => {
    show();
    // Two ways out, because they are two different claims about what the
    // client has actually seen.
    expect(await screen.findByRole('button', { name: 'Email it to the client' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mark as sent' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Client accepted' })).not.toBeInTheDocument();
  });

  it('emailing it asks the server to deliver; marking it sent does not', async () => {
    answerQuotation.mockResolvedValue(quotationOf({ state: 'sent' }));
    show();

    await userEvent.click(await screen.findByRole('button', { name: 'Email it to the client' }));
    expect(answerQuotation).toHaveBeenCalledWith('q-1', 'send', { deliver: true });

    answerQuotation.mockClear();
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as sent' }));
    // No delivery asked for: somebody printed it and handed it over.
    expect(answerQuotation).toHaveBeenCalledWith('q-1', 'send', {});
  });

  it('says how it reached the client once it has gone', async () => {
    quotations.mockResolvedValue([
      quotationOf({ state: 'sent', sentAt: '2026-09-22T08:00:00.000Z', sentVia: 'email' }),
    ]);
    show();

    expect(await screen.findByText(/Emailed to the client on/)).toBeInTheDocument();
  });

  it('adds a fixed line in whole fils', async () => {
    addQuotationLine.mockResolvedValue(quotationOf());
    show();

    await userEvent.type(await screen.findByLabelText('Description (English)'), 'Bookkeeping');
    await userEvent.type(screen.getByLabelText('Amount'), '1500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Add a line' }));

    await waitFor(() =>
      expect(addQuotationLine).toHaveBeenCalledWith('q-1', {
        descriptionEn: 'Bookkeeping',
        descriptionAr: '',
        amountMinor: 150_050,
      }),
    );
  });

  it('adds an hourly line with its estimate and rate', async () => {
    addQuotationLine.mockResolvedValue(quotationOf());
    show();

    await userEvent.click(await screen.findByRole('button', { name: 'By the hour' }));
    await userEvent.type(screen.getByLabelText('Description (English)'), 'VAT registration');
    await userEvent.type(screen.getByLabelText('Estimated hours'), '4');
    await userEvent.type(screen.getByLabelText('Hourly rate'), '250');
    await userEvent.click(screen.getByRole('button', { name: 'Add a line' }));

    await waitFor(() =>
      expect(addQuotationLine).toHaveBeenCalledWith('q-1', {
        descriptionEn: 'VAT registration',
        descriptionAr: '',
        hours: 4,
        perHourMinor: 25_000,
      }),
    );
  });

  it('will not add a line with no description or no price', async () => {
    show();
    await screen.findByLabelText('Amount');

    const add = screen.getByRole('button', { name: 'Add a line' });
    expect(add).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Description (English)'), 'Bookkeeping');
    expect(add).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Amount'), '100');
    expect(add).toBeEnabled();
  });

  it('accepts a line described only in Arabic', async () => {
    addQuotationLine.mockResolvedValue(quotationOf());
    show();

    await userEvent.type(await screen.findByLabelText('Description (Arabic)'), 'مسك الدفاتر');
    await userEvent.type(screen.getByLabelText('Amount'), '100');
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeEnabled();
  });

  it('removes a line', async () => {
    removeQuotationLine.mockResolvedValue(quotationOf({ lines: [] }));
    show();

    const buttons = await screen.findAllByRole('button', { name: 'Remove' });
    await userEvent.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(removeQuotationLine).toHaveBeenCalledWith('q-1', 'ql-1'));
  });
});

describe('once it is with the client', () => {
  it('offers accept and decline, and no editing', async () => {
    quotations.mockResolvedValue([quotationOf({ state: 'sent', sentAt: '2026-09-22T09:00:00Z' })]);
    show();

    expect(await screen.findByRole('button', { name: 'Client accepted' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Client declined' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add a line' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('records the client’s answer', async () => {
    quotations.mockResolvedValue([quotationOf({ state: 'sent' })]);
    answerQuotation.mockResolvedValue(quotationOf({ state: 'accepted' }));
    show();

    await userEvent.click(await screen.findByRole('button', { name: 'Client accepted' }));
    await waitFor(() => expect(answerQuotation).toHaveBeenCalledWith('q-1', 'accept', {}));
  });
});

describe('once it has lapsed', () => {
  it('offers neither answer, and says to re-quote', async () => {
    quotations.mockResolvedValue([quotationOf({ state: 'expired' })]);
    show();

    // Standing behind a price that expired is the thing to avoid.
    expect(await screen.findByText(/Re-quote rather than standing behind/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Client accepted' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Email it to the client' }),
    ).not.toBeInTheDocument();
  });
});

describe('in Arabic', () => {
  it('shows the Arabic description rather than the English one', async () => {
    await useLanguage('ar');
    show();
    expect(await screen.findByText('التسجيل الضريبي')).toBeInTheDocument();
    expect(screen.queryByText('VAT registration')).not.toBeInTheDocument();
  });
});
