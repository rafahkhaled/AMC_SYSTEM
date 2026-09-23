import type { FirmProfile, InvoiceView, QuotationView } from '@amc/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { InvoiceDocument, QuotationDocument } from './document.js';

const aed = (minorUnits: number) => ({ minorUnits, currency: 'AED' });

const profile = (over: Partial<FirmProfile> = {}): FirmProfile => ({
  legalName: 'Active M Consultancy FZE LLC',
  addresses: ['Dubai: an office', 'Ajman: another office'],
  bank: { accountHolder: 'Active M Consultancy FZE LLC', iban: 'AE00', bic: 'ABCDAEAA' },
  logoUrl: null,
  stampUrl: null,
  ...over,
});

const invoice = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: 'inv-1',
  clientId: 'c-1',
  clientName: 'Skytrek Aviation L.L.C',
  statementId: 's-1',
  number: '2070',
  status: 'issued',
  settlement: 'issued',
  currency: 'AED',
  lines: [
    {
      id: 'il-1',
      projectId: 'p-1',
      service: 'ct_return',
      descriptionEn: 'Tax-(VAT & CT)',
      descriptionAr: 'CT Re-turn 2025',
      workedSeconds: 7200,
      amount: aed(175_000),
      quantityCenti: 100,
      unitRate: aed(175_000),
    },
  ],
  payments: [],
  vatBasisPoints: 0,
  net: aed(175_000),
  vat: aed(0),
  total: aed(175_000),
  paid: aed(0),
  balance: aed(175_000),
  issuedOn: '2026-09-11T08:00:00.000Z',
  dueOn: '2026-10-11T08:00:00.000Z',
  overdueSince: null,
  collectionPending: false,
  openProjects: 0,
  ...over,
});

const quotation = (over: Partial<QuotationView> = {}): QuotationView => ({
  id: 'q-1',
  clientId: 'c-1',
  clientName: 'Skytrek Aviation L.L.C',
  reference: '192',
  state: 'sent',
  currency: 'AED',
  lines: [
    {
      id: 'ql-1',
      descriptionEn: 'Tax-(VAT & CT)',
      descriptionAr: 'CT Re-turn 2025',
      kind: 'fixed',
      hours: null,
      perHour: null,
      amount: aed(175_000),
    },
  ],
  total: aed(175_000),
  validUntil: null,
  sentAt: null,
  sentVia: null,
  decidedAt: null,
  notesEn: null,
  notesAr: null,
  createdAt: '2026-08-14T08:00:00.000Z',
  ...over,
});

describe('the invoice, as the client receives it', () => {
  it('carries the firm, the client, the number and the date', async () => {
    await useLanguage('en');
    renderScreen(<InvoiceDocument invoice={invoice()} profile={profile()} />);

    expect(screen.getByText('Active M Consultancy FZE LLC')).toBeInTheDocument();
    expect(screen.getByText('Skytrek Aviation L.L.C')).toBeInTheDocument();
    expect(screen.getByText('2070')).toBeInTheDocument();
    // The firm writes its dates this way and no locale produces it.
    expect(screen.getByText('11-Sept-2026')).toBeInTheDocument();
  });

  it('shows quantity, rate and amount, and a total that agrees with them', async () => {
    await useLanguage('en');
    renderScreen(<InvoiceDocument invoice={invoice()} profile={profile()} />);

    // The description cell holds two lines, so match the cell rather than a
    // text node that the line break splits in two.
    const row = screen.getByText(/Tax-\(VAT & CT\)/).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(row as HTMLElement).getAllByText('1,750.00')).toHaveLength(2);
    expect(screen.getByText('AED 1,750.00')).toBeInTheDocument();
  });

  it('has no VAT line, because the firm’s document has none', async () => {
    await useLanguage('en');
    renderScreen(<InvoiceDocument invoice={invoice()} profile={profile()} />);

    /*
     * The firm is not VAT registered and its invoice totals the work and
     * stops. Matched exactly: the line's own description is "Tax-(VAT & CT)",
     * which is the service being billed and not a tax being charged.
     */
    expect(screen.queryByText(/^VAT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Subtotal$/)).not.toBeInTheDocument();
  });

  it('shows the VAT once the firm is registered, or the page will not add up', async () => {
    await useLanguage('en');
    renderScreen(
      <InvoiceDocument
        invoice={invoice({
          vatBasisPoints: 500,
          net: aed(175_000),
          vat: aed(8_750),
          total: aed(183_750),
          balance: aed(183_750),
        })}
        profile={profile()}
      />,
    );

    // Without these the line says 1,750.00 and the total says 1,837.50, and
    // a client reading a document that does not add up is right to query it.
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('VAT 5%')).toBeInTheDocument();
    expect(screen.getByText('87.50')).toBeInTheDocument();
    expect(screen.getByText('AED 1,837.50')).toBeInTheDocument();
  });

  it('marks a missing bank detail rather than leaving a gap', async () => {
    await useLanguage('en');
    renderScreen(
      <InvoiceDocument
        invoice={invoice()}
        profile={profile({ bank: { accountHolder: 'Someone', iban: null, bic: null } })}
      />,
    );

    // An invoice with a blank where the IBAN should be reads as finished and
    // cannot be paid. Two marks: the IBAN and the BIC.
    expect(screen.getAllByText('______')).toHaveLength(2);
  });

  it('stays in English even when the interface is Arabic', async () => {
    await useLanguage('ar');
    renderScreen(<InvoiceDocument invoice={invoice()} profile={profile()} />);

    /*
     * The client has had this document for years and the FTA reads it too.
     * Mirroring it because the operator's interface is Arabic would send a
     * different document than the one they know.
     */
    expect(document.querySelector('.doc')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('Description')).toBeInTheDocument();
  });
});

describe('the quotation', () => {
  it('is headed Quotation, with an estimate number and the customer', async () => {
    await useLanguage('en');
    renderScreen(<QuotationDocument quotation={quotation()} profile={profile()} />);

    expect(screen.getByRole('heading', { name: 'Quotation' })).toBeInTheDocument();
    expect(screen.getByText('Estimate #')).toBeInTheDocument();
    expect(screen.getByText('192')).toBeInTheDocument();
    expect(screen.getByText('Customer Name')).toBeInTheDocument();
  });

  it('shows the hours it was priced on when it was priced that way', async () => {
    await useLanguage('en');
    renderScreen(
      <QuotationDocument
        quotation={quotation({
          lines: [
            {
              id: 'ql-1',
              descriptionEn: 'Bookkeeping',
              descriptionAr: 'مسك الدفاتر',
              kind: 'hours',
              hours: 12,
              perHour: aed(30_000),
              amount: aed(360_000),
            },
          ],
          total: aed(360_000),
        })}
        profile={profile()}
      />,
    );

    const row = screen.getByText(/Bookkeeping/).closest('tr');
    // The hours are the part a client argues with, and hiding them behind one
    // figure makes that conversation harder rather than shorter.
    expect(within(row as HTMLElement).getByText('12.00')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('300.00')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('3,600.00')).toBeInTheDocument();
  });

  it('leaves room for the client to stamp it, and carries no bank details', async () => {
    await useLanguage('en');
    renderScreen(<QuotationDocument quotation={quotation()} profile={profile()} />);

    expect(screen.getByText("Customer's Stamp & Signature")).toBeInTheDocument();
    // A quotation is not a request for payment.
    expect(screen.queryByText('Bank Details:')).not.toBeInTheDocument();
  });
});
