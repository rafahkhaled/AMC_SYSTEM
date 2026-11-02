import type { FirmProfile, InvoiceView, PaymentView, QuotationView } from '@amc/contracts';
import { useTranslation } from 'react-i18next';
import { letterheadFor } from '../branches/letterhead.js';
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
  partyContact,
  dateLabel,
  dateValue,
  referenceLabel,
  amountHeading,
  lines,
  total,
  beforeTotal,
  children,
  logoFirst,
  totalUnderlined = false,
}: {
  profile: FirmProfile;
  title: string;
  reference: string;
  partyLabel: string;
  partyName: string;
  /** The person at the client, on the line under the name. */
  partyContact: string | null;
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
  /** The quotation's total stands on its own, bold and underlined; the invoice's is boxed. */
  totalUnderlined?: boolean;
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
        {/* The quotation leads with the mark and names the firm beside it;
            the invoice leads with the name and puts the mark on the right.
            No branch name: the firm's templates print none, and the branch
            shows in its address and bank account at the foot. */}
        <div className={logoFirst ? 'doc__headStart doc__headStart--beside' : 'doc__headStart'}>
          {logoFirst ? mark : null}
          <strong className={logoFirst ? 'doc__firm doc__firm--besideMark' : 'doc__firm'}>
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
        <p>
          {partyName}
          {partyContact ? (
            <>
              <br />
              {partyContact}
            </>
          ) : null}
        </p>
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
              {/* The sheet runs left to right; the Arabic second line does
                  not, and takes its own direction from its own first letter. */}
              <td className="doc__description u-typed">
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

      <div className={totalUnderlined ? 'doc__total doc__total--underlined' : 'doc__total'}>
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
  /*
   * The letterhead of the branch it was issued under, which is fixed at issue.
   * Taken here, where it is printed, so no caller can forget to: an invoice for
   * the Ajman branch that came out with Dubai's address and bank account would
   * be paid to the wrong place.
   */
  const printed = letterheadFor(profile, invoice.branch);

  return (
    <Sheet
      profile={printed}
      logoFirst={false}
      title={t('billing.document.invoice')}
      dateLabel={t('billing.document.date')}
      dateValue={documentDate(invoice.issuedOn)}
      referenceLabel={t('billing.document.invoiceNo')}
      reference={invoice.number}
      partyLabel={t('billing.document.invoiceTo')}
      partyName={invoice.clientName ?? invoice.clientId}
      partyContact={invoice.clientContact}
      amountHeading={t('billing.document.amount')}
      lines={invoice.lines.map((line) => ({
        key: line.id,
        description: line.descriptionEn || line.descriptionAr,
        note: null,
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
          <Firm value={printed.bank?.accountHolder ?? null} />
          <br />
          IBAN: <Firm value={printed.bank?.iban ?? null} />
          <br />
          BIC: <Firm value={printed.bank?.bic ?? null} />
        </p>
        {printed.stampUrl ? <img className="doc__stamp" src={printed.stampUrl} alt="" /> : null}
      </section>

      <footer className="doc__addresses doc__addresses--centred">
        <span>{t('billing.document.businessAddress')}</span>
        {printed.addresses.length === 0 ? <span>{MISSING}</span> : null}
        {printed.addresses.map((address) => (
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
  const printed = letterheadFor(profile, quotation.branch);

  return (
    <Sheet
      profile={printed}
      logoFirst={true}
      totalUnderlined
      title={t('billing.document.quotation')}
      dateLabel={t('billing.document.date')}
      dateValue={documentDate(quotation.createdAt)}
      referenceLabel={t('billing.document.estimateNo')}
      reference={quotation.reference}
      partyLabel={t('billing.document.customerName')}
      partyName={quotation.clientName ?? quotation.clientId}
      partyContact={quotation.clientContact}
      amountHeading={t('billing.document.total')}
      /*
       * A discount is a line of its own under the line it came off, with a
       * quantity of -1, as the firm's invoices write it: "Accounting &
       * Bookkeeping-Discount  -1  525.00  -525.00". The column then adds up to
       * the total without a separate discount row.
       */
      lines={quotation.lines.flatMap((line) => {
        const hourly = line.kind === 'hours' && line.hours !== null;
        const description = line.descriptionEn || line.descriptionAr;
        const charged = {
          key: line.id,
          description,
          note: null,
          // A quotation priced by hours shows the hours it was priced on: that
          // is the part the client argues with.
          qty: hourly && line.hours !== null ? line.hours.toFixed(2) : '1',
          rate: plain(hourly && line.perHour ? line.perHour : line.amount),
          amount: plain(line.amount),
        };
        if (line.discount.minorUnits <= 0) return [charged];
        return [
          charged,
          {
            key: `${line.id}-discount`,
            description: `${description}-Discount`,
            note: null,
            qty: '-1',
            rate: plain(line.discount),
            amount: `-${plain(line.discount)}`,
          },
        ];
      })}
      total={`${quotation.total.currency} ${plain(quotation.total)}`}
      /*
       * The VAT rows, when there is any VAT on the document.
       *
       * Without them the amount column adds up to one figure and the Total
       * says another, and a client reading a document that does not add up is
       * right to query it. Absent entirely on a quotation that is all out of
       * scope, which is how the firm's own template has always looked.
       */
      /*
       * The VAT rows, when there is any VAT on the document: without them the
       * column adds up to one figure and the Total says another. Absent on a
       * quotation that is all out of scope, as the firm's template is.
       */
      beforeTotal={
        quotation.vat.minorUnits > 0 ? (
          <div className="doc__tax">
            <span>
              <span>{t('billing.document.net')}</span>
              <span>{plain(quotation.net)}</span>
            </span>
            <span>
              <span>{t('billing.document.vat')}</span>
              <span>{plain(quotation.vat)}</span>
            </span>
          </div>
        ) : null
      }
    >
      <div className="doc__sign">
        {printed.stampUrl ? <img className="doc__stamp" src={printed.stampUrl} alt="" /> : <span />}
        <section className="doc__customerStamp">
          <h2>{t('billing.document.customerStamp')}</h2>
        </section>
      </div>

      <footer className="doc__addresses">
        {printed.addresses.length === 0 ? <span className="doc__address">{MISSING}</span> : null}
        {printed.addresses.map((address) => (
          <span className="doc__address" key={address}>
            {address}
          </span>
        ))}
      </footer>
    </Sheet>
  );
}

/**
 * The receipt voucher (سند قبض) for one payment, as the firm's paper one.
 *
 * Bilingual on every row, English on the left and Arabic on the right with
 * the value between them, so it reads the same whichever language the client
 * reads. Printed from the invoice it paid, which is where the number and the
 * client come from.
 */
export function ReceiptDocument({
  invoice,
  payment,
  profile,
}: {
  invoice: InvoiceView;
  payment: PaymentView;
  profile: FirmProfile;
}) {
  const { t } = useTranslation();
  const printed = letterheadFor(profile, invoice.branch);
  const r = (key: string, options?: Record<string, string>) =>
    t(`billing.document.receipt.${key}`, options ?? {});
  const sum = `${figure(payment.amount)} ${payment.amount.currency}`;
  const tick = (ticked: boolean) => (ticked ? '\u2611' : '\u2610');

  return (
    <article className="doc doc--receipt" dir="ltr" lang="en">
      <header className="doc__receiptHead">
        {printed.logoUrl ? <img className="doc__logo" src={printed.logoUrl} alt="" /> : null}
        {/* The name the firm trades under, which is what its vouchers carry,
            rather than the legal name on the invoice. */}
        <span className="doc__receiptFirm">{r('firm')}</span>
        <span className="doc__receiptAddress">
          {printed.addresses[0] ?? <span className="doc__missing">{MISSING}</span>}
        </span>
        <strong>{r('title')}</strong>
        <strong lang="ar" dir="rtl" className="doc__receiptTitleAr">
          {r('titleAr')}
        </strong>
      </header>

      <table className="doc__receipt">
        <tbody>
          <tr>
            <th>
              {r('voucherNo')}
              {payment.voucher}
            </th>
            <td />
            <th className="doc__receiptDate">
              {r('date')} {dashed(payment.receivedOn)}
            </th>
          </tr>
          <tr className="doc__receiptGap">
            <td colSpan={3} />
          </tr>
          <tr>
            <th>{r('receivedFrom')}</th>
            <td className="u-typed">{invoice.clientName ?? invoice.clientId}</td>
            <th lang="ar" dir="rtl">
              {r('receivedFromAr')}
            </th>
          </tr>
          <tr>
            <th>{r('sumOf')}</th>
            <td>
              <strong>{sum}</strong>
            </td>
            <th lang="ar" dir="rtl">
              {r('sumOfAr')}
            </th>
          </tr>
          <tr>
            <th>{r('amount')}</th>
            <td>
              <strong>{sum}</strong>
            </td>
            <th lang="ar" dir="rtl">
              {r('amountAr')}
            </th>
          </tr>
          <tr>
            <th>{r('mode')}</th>
            <td className="doc__receiptModes">
              <span>
                {tick(payment.method === 'cash')} {r('cash')}
              </span>
              <span>
                {tick(payment.method === 'cheque')} {r('cheque')}
              </span>
            </td>
            <th lang="ar" dir="rtl">
              {r('modeAr')}
            </th>
          </tr>
          <tr>
            <th>
              {r('bank')}
              <br />
              {r('date')}
            </th>
            <td>
              <strong>
                {payment.bankName ?? ''}
                <br />
                {slashed(payment.chequeDate ?? payment.receivedOn)}
              </strong>
            </td>
            <th lang="ar" dir="rtl">
              {r('bankAr')}
              <br />
              {r('dateAr')}
            </th>
          </tr>
          <tr className="doc__receiptGap">
            <td colSpan={3} />
          </tr>
          <tr className="doc__receiptFor">
            <th>{r('beingFor')}</th>
            <td>
              <strong>{r('invoiceNo', { number: invoice.number })}</strong>
            </td>
            <th lang="ar" dir="rtl">
              {r('beingForAr')}
            </th>
          </tr>
          <tr className="doc__receiptBlank">
            <td colSpan={3} />
          </tr>
          <tr className="doc__receiptSign">
            <th className="doc__receiptSignLabel">{r('signature')}</th>
            <td>
              {printed.stampUrl ? (
                <img className="doc__stamp" src={printed.stampUrl} alt="" />
              ) : null}
            </td>
            <th lang="ar" dir="rtl" className="doc__receiptSignLabel">
              {r('signatureAr')}
            </th>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

/** `1550`, or `1550.50`: the voucher writes the figure plainly, without grouping. */
function figure(amount: { minorUnits: number }): string {
  const whole = amount.minorUnits % 100 === 0;
  return whole ? String(amount.minorUnits / 100) : (amount.minorUnits / 100).toFixed(2);
}

/** `08-09-2026`, the voucher's own date. */
function dashed(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}-${month}-${year}`;
}

/** `29/08/2026`, the cheque or transfer date as the voucher writes it. */
function slashed(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * `11-Sep-2026`, as the firm writes it.
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
    'Jun',
    'Jul',
    'Aug',
    'Sep',
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
