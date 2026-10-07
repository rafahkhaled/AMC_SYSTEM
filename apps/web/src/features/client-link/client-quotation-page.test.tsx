import type { ClientQuotationView } from '@amc/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ClientQuotationPage } from './client-quotation-page.js';

const openQuotation = vi.hoisted(() => vi.fn());
const answerQuotation = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ openQuotation, answerQuotation }));

const aed = (minorUnits: number) => ({ minorUnits, currency: 'AED' });

/**
 * A quotation with something taken off it and VAT on what was left.
 *
 * The shape the firm asked for in item 13, because that is the one with
 * something to check: a page showing only a total asks a client to agree to a
 * figure they cannot arrive at themselves.
 */
function view(over: Partial<ClientQuotationView> = {}): ClientQuotationView {
  return {
    firmName: 'Active M Consultancy FZE LLC',
    reference: '193',
    state: 'sent',
    currency: 'AED',
    lines: [
      {
        descriptionEn: 'VAT return',
        descriptionAr: 'إقرار القيمة المضافة',
        amount: aed(500_000),
        discount: aed(50_000),
        vatBasisPoints: 500,
        vat: aed(22_500),
        chargeable: aed(472_500),
      },
      {
        descriptionEn: 'Authority fee',
        descriptionAr: 'رسوم حكومية',
        amount: aed(100_000),
        discount: aed(0),
        vatBasisPoints: null,
        vat: aed(0),
        chargeable: aed(100_000),
      },
    ],
    subtotal: aed(600_000),
    discount: aed(50_000),
    net: aed(550_000),
    vat: aed(22_500),
    total: aed(572_500),
    validUntil: '2026-11-30',
    notesEn: null,
    notesAr: null,
    answerable: true,
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  openQuotation.mockResolvedValue(view());
});

describe('what the client is shown', () => {
  it('names the firm that sent it', async () => {
    renderScreen(<ClientQuotationPage token="t" />);
    // A client opening an unfamiliar link to a page of their own prices, with
    // no name on it, has every reason to close the tab.
    expect(await screen.findByText('Active M Consultancy FZE LLC')).toBeInTheDocument();
  });

  it('shows how the total was arrived at, not only the total', async () => {
    renderScreen(<ClientQuotationPage token="t" />);

    const total = await screen.findByText('Total payable');
    const foot = total.closest('tfoot') as HTMLElement;

    expect(within(foot).getByText('Before discount')).toBeInTheDocument();
    expect(within(foot).getByText('Discount')).toBeInTheDocument();
    expect(within(foot).getByText('Net of VAT')).toBeInTheDocument();
    expect(within(foot).getByText('VAT')).toBeInTheDocument();
    expect(within(foot).getByText(/5,725\.00/)).toBeInTheDocument();
  });

  it('puts the discount against the line it came off', async () => {
    renderScreen(<ClientQuotationPage token="t" />);
    expect(await screen.findByText(/less AED\s*500\.00/)).toBeInTheDocument();
  });

  it('charges a line that is out of scope at what it says', async () => {
    renderScreen(<ClientQuotationPage token="t" />);
    // No VAT row appears for it and no VAT is added: 1,000 is 1,000.
    expect(await screen.findByText(/1,000\.00/)).toBeInTheDocument();
  });

  it('leaves the breakdown off a quotation that has nothing to break down', async () => {
    openQuotation.mockResolvedValue(
      view({
        lines: [
          {
            descriptionEn: 'Tax-(VAT & CT)',
            descriptionAr: '',
            amount: aed(175_000),
            discount: aed(0),
            vatBasisPoints: null,
            vat: aed(0),
            chargeable: aed(175_000),
          },
        ],
        subtotal: aed(175_000),
        discount: aed(0),
        net: aed(175_000),
        vat: aed(0),
        total: aed(175_000),
      }),
    );
    renderScreen(<ClientQuotationPage token="t" />);

    await screen.findByText('Total payable');
    // Rows that would say nothing are worse than no rows: they read as a
    // mistake on a document the client is being asked to agree to.
    expect(screen.queryByText('Discount')).not.toBeInTheDocument();
    expect(screen.queryByText('VAT')).not.toBeInTheDocument();
  });
});

describe('answering it', () => {
  it('asks twice, because there is no way back from here', async () => {
    answerQuotation.mockResolvedValue(view({ state: 'accepted', answerable: false }));
    renderScreen(<ClientQuotationPage token="t" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Accept this quotation' }));
    expect(answerQuotation).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, accept it' }));
    expect(answerQuotation).toHaveBeenCalledWith('t', 'accept');
  });

  it('offers nothing to do with one that has lapsed', async () => {
    openQuotation.mockResolvedValue(view({ state: 'expired', answerable: false }));
    renderScreen(<ClientQuotationPage token="t" />);

    expect(await screen.findByText(/has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept this quotation' })).not.toBeInTheDocument();
  });

  it('reads the same for every refusal, whatever the reason', async () => {
    // A wrong token, a lapsed link and one already answered all refuse the
    // same way on the server; a page explaining the difference would undo it.
    openQuotation.mockRejectedValue(new Error('unavailable'));
    renderScreen(<ClientQuotationPage token="t" />);

    expect(await screen.findByText('This link is not available')).toBeInTheDocument();
  });
});
