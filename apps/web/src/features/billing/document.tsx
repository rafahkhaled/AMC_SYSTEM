import type { FirmProfile, InvoiceView, QuotationView } from '@amc/contracts';
import { useTranslation } from 'react-i18next';
import { formatMoney } from './money.js';

/**
 * The firm's own quotation and invoice, on paper (FR-30, FR-32).
 *
 * Printed from the browser rather than rendered to a PDF on the server. That
 * is the same decision the letters made and for the same reason: Arabic needs
 * shaping and bidirectional layout that browsers get right and server-side PDF
 * libraries mostly do not, and "print to PDF" is one keystroke in every
 * browser the firm uses.
 *
 * The layout is the firm's existing template, followed closely on purpose —
 * clients have been receiving this document for years and a redesign is not
 * what anybody asked for. Notably: no VAT line. It totals the work and stops.
 */

/** What a missing detail looks like. Never a blank — see LetterFacts. */
const MISSING = '______';

function Firm({ value }: { value: string | null }) {
  return value ? <>{value}</> : <span className="doc__missing">{MISSING}</span>;
}

/**
 * Both documents share a shape: heading block, party box, ruled table, total.
 * They differ in what sits either side of the heading and what follows the
 * total, so the frame is shared and the ends are passed in.
 */
function Sheet({
  profile,
  title,
  reference,
  partyLabel,
  partyName,
  dateLabel,
  dateValue,
  referenceLabel,
  amountHeading,
  lines,
  total,
  beforeTotal,
  children,
  logoFirst,
}: {
  profile: FirmProfile;
  title: string;
  reference: string;
  partyLabel: string;
  partyName: string;
  dateLabel: string;
  dateValue: string;
  referenceLabel: string;
  amountHeading: string;
  lines: readonly {
    key: string;
    description: string;
    note: string | null;
    qty: string;
    rate: string;
    amount: string;
  }[];
  total: string;
  beforeTotal?: React.ReactNode;
  children: React.ReactNode;
  logoFirst: boolean;
}) {
  const { t } = useTranslation();

  const mark = profile.logoUrl ? (
    <img className="doc__logo" src={profile.logoUrl} alt="" />
  ) : (
    <span className="doc__logo doc__logo--absent" aria-hidden="true" />
  );

  return (
    /*
     * `dir="ltr"` on the sheet itself, whatever the interface language.
     *
     * This document goes to a client and to the FTA, and the firm's template
     * is an English document with English column headings. Mirroring it
     * because the operator happens to have the interface in Arabic would send
     * a different document than the one the client has had for years.
     */
    <article className="doc" dir="ltr" lang="en">
      <header className="doc__head">
        {/* The quotation leads with the mark and names the firm beneath it;
            the invoice leads with the name and puts the mark on the right.
            Both are columns, so neither depends on a logo being configured to
            keep its shape. */}
        <div className="doc__headStart">
          {logoFirst ? mark : null}
          <strong className={logoFirst ? 'doc__firm doc__firm--underMark' : 'doc__firm'}>
            {profile.legalName}
          </strong>
        </div>
        <div className="doc__headEnd">
          {logoFirst ? null : mark}
          <h1 className="doc__title">{title}</h1>
          <table className="doc__meta">
            <thead>
              <tr>
                <th>{dateLabel}</th>
                <th>{referenceLabel}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{dateValue}</td>
                <td>{reference}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>

      <section className="doc__party">
        <h2>{partyLabel}</h2>
        <p>{partyName}</p>
      </section>

      {/* One ruled box down the page whether it holds one line or twenty, as
          the firm's template does. The rules are the document; a table that
          shrank to its content would look like a different form. */}
      <table className="doc__lines">
        <thead>
          <tr>
            <th className="doc__description">{t('billing.document.description')}</th>
            <th className="doc__qty">{t('billing.document.qty')}</th>
            <th className="doc__rate">{t('billing.document.rate')}</th>
            <th className="doc__amount">{amountHeading}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <td className="doc__description">
                {line.description}
                {line.note ? (
                  <>
                    <br />
                    {line.note}
                  </>
                ) : null}
              </td>
              <td className="doc__qty">{line.qty}</td>
              <td className="doc__rate">{line.rate}</td>
              <td className="doc__amount">{line.amount}</td>
            </tr>
          ))}
          {/* The empty remainder of the box. */}
          <tr className="doc__filler">
            <td colSpan={4} />
          </tr>
        </tbody>
      </table>

      {beforeTotal}

      <div className="doc__total">
        <strong>{t('billing.document.total')}</strong>
        <strong className="doc__totalAmount">{total}</strong>
      </div>

      <p className="doc__generated">{t('billing.document.generated')}</p>

      {children}
    </article>
  );
}

export function InvoiceDocument({
  invoice,
  profile,
}: {
  invoice: InvoiceView;
  profile: FirmProfile;
}) {
  const { t } = useTranslation();

  return (
    <Sheet
      profile={profile}
      logoFirst={false}
      title={t('billing.document.invoice')}
      dateLabel={t('billing.document.date')}
      dateValue={documentDate(invoice.issuedOn)}
      referenceLabel={t('billing.document.invoiceNo')}
      reference={invoice.number}
      partyLabel={t('billing.document.invoiceTo')}
      partyName={invoice.clientName ?? invoice.clientId}
      amountHeading={t('billing.document.amount')}
      lines={invoice.lines.map((line) => ({
        key: line.id,
        description: line.descriptionEn,
        note: line.descriptionAr || null,
        qty: quantity(line.quantityCenti),
        // Null on a line raised before the document recorded these. The
        // amount is always right, so it stands in rather than a zero.
        rate: plain(line.unitRate ?? line.amount),
        amount: plain(line.amount),
      }))}
      /*
       * The invoice total, which is what the client owes including any VAT.
       * The firm's template shows no VAT line because the firm is not
       * registered; when it is, the figure here still has to be the one the
       * client pays, so it reads `total` and not `net`.
       */
      total={`${invoice.total.currency} ${plain(invoice.total)}`}
      /*
       * No VAT rows while the firm is not registered, which is why its own
       * template has none — it totals the work and stops.
       *
       * The moment it does register, they have to appear: without them the
       * lines add up to one figure and the Total says another, and a client
       * reading a document that does not add up is right to query it. The
       * rate decides, not a flag, so this follows the invoice rather than a
       * setting that may have changed since it was issued.
       */
      beforeTotal={
        invoice.vatBasisPoints > 0 ? (
          <div className="doc__tax">
            <span>
              <span>{t('billing.document.subtotal')}</span>
              <span>{plain(invoice.net)}</span>
            </span>
            <span>
              <span>
                {t('billing.document.vatAt', {
                  rate: (invoice.vatBasisPoints / 100).toFixed(
                    invoice.vatBasisPoints % 100 === 0 ? 0 : 2,
                  ),
                })}
              </span>
              <span>{plain(invoice.vat)}</span>
            </span>
          </div>
        ) : null
      }
    >
      <section className="doc__bank">
        <h2>{t('billing.document.bankDetails')}</h2>
        <p>
          {t('billing.document.accountHolder')}:{' '}
          <Firm value={profile.bank?.accountHolder ?? null} />
          <br />
          IBAN: <Firm value={profile.bank?.iban ?? null} />
          <br />
          BIC: <Firm value={profile.bank?.bic ?? null} />
        </p>
        {profile.stampUrl ? <img className="doc__stamp" src={profile.stampUrl} alt="" /> : null}
      </section>

      <footer className="doc__addresses doc__addresses--centred">
        <span>{t('billing.document.businessAddress')}</span>
        {profile.addresses.length === 0 ? <span>{MISSING}</span> : null}
        {profile.addresses.map((address) => (
          <span key={address}>{address}</span>
        ))}
      </footer>
    </Sheet>
  );
}

export function QuotationDocument({
  quotation,
  profile,
}: {
  quotation: QuotationView;
  profile: FirmProfile;
}) {
  const { t } = useTranslation();

  return (
    <Sheet
      profile={profile}
      logoFirst={true}
      title={t('billing.document.quotation')}
      dateLabel={t('billing.document.date')}
      dateValue={documentDate(quotation.createdAt)}
      referenceLabel={t('billing.document.estimateNo')}
      reference={quotation.reference}
      partyLabel={t('billing.document.customerName')}
      partyName={quotation.clientName ?? quotation.clientId}
      amountHeading={t('billing.document.total')}
      lines={quotation.lines.map((line) => ({
        key: line.id,
        description: line.descriptionEn,
        note: line.descriptionAr || null,
        // A quotation priced by hours shows the hours it was priced on: that
        // is the part the client argues with, and hiding it behind a single
        // figure makes the conversation harder rather than shorter.
        qty: line.kind === 'hours' && line.hours !== null ? line.hours.toFixed(2) : '1',
        rate: plain(line.kind === 'hours' && line.perHour ? line.perHour : line.amount),
        amount: plain(line.amount),
      }))}
      total={`${quotation.total.currency} ${plain(quotation.total)}`}
    >
      <div className="doc__sign">
        {profile.stampUrl ? <img className="doc__stamp" src={profile.stampUrl} alt="" /> : <span />}
        <section className="doc__customerStamp">
          <h2>{t('billing.document.customerStamp')}</h2>
        </section>
      </div>

      <footer className="doc__addresses">
        {profile.addresses.length === 0 ? <span className="doc__address">{MISSING}</span> : null}
        {profile.addresses.map((address) => (
          <span className="doc__address" key={address}>
            {address}
          </span>
        ))}
      </footer>
    </Sheet>
  );
}

/**
 * `11-Sept-2026`, as the firm writes it.
 *
 * Built by hand rather than through Intl: no locale produces this exact form,
 * and the document is the firm's, not the browser's.
 */
function documentDate(iso: string): string {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'June',
    'July',
    'Aug',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ];
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

/** `2.50` from 250 hundredths. */
function quantity(centi: number): string {
  return centi % 100 === 0 ? String(centi / 100) : (centi / 100).toFixed(2);
}

/** `1,750.00`: grouped, two places, and no currency — the column has none. */
function plain(amount: { minorUnits: number; currency: string }): string {
  return formatMoney(amount, 'en').replace(/[^\d.,]/g, '');
}
