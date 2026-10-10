import type { QuotationView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Select } from '../../design/index.js';
import { listClients } from '../clients/api.js';
import { useServices } from '../services/use-services.js';
import {
  addQuotationLine,
  answerQuotation,
  draftQuotation,
  quotations as fetchQuotations,
  firmProfile,
  removeQuotationLine,
} from './api.js';
import { QuotationDocument } from './document.js';
import { formatMoney, minorUnitsFrom } from './money.js';

/**
 * Quotations (FR-30).
 *
 * The firm's offer, before any work exists. It never becomes an invoice —
 * work happens in between and what is billed is the statement of that work —
 * so this screen ends at "the client said yes", and the answer is the point
 * of it.
 */
export function Quotations({
  openId,
  onOpen,
}: {
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const list = useQuery({ queryKey: ['billing', 'quotations'], queryFn: () => fetchQuotations() });

  return (
    <>
      <NewQuotation onDrafted={onOpen} />

      <Card title={t('billing.quotations.title')} description={t('billing.quotations.hint')}>
        {list.isLoading ? <Loading label={t('loading')} /> : null}
        {list.isError ? <Alert tone="error">{t('billing.failed')}</Alert> : null}
        {list.data && list.data.length === 0 ? (
          <Empty
            title={t('billing.quotations.none')}
            description={t('billing.quotations.noneHint')}
          />
        ) : null}

        <div className="u-stack-tight">
          {(list.data ?? []).map((quotation) => (
            <button
              key={quotation.id}
              type="button"
              className={`row row--button${quotation.id === openId ? ' row--open' : ''}`}
              aria-expanded={quotation.id === openId}
              onClick={() => onOpen(quotation.id === openId ? null : quotation.id)}
            >
              <span className="row__main">
                <strong className="u-ltr">{quotation.reference}</strong>
                <span className="u-text-faint">{quotation.clientName ?? quotation.clientId}</span>
              </span>
              <span className="u-row u-row--tight">
                <span className="u-numeric">{formatMoney(quotation.total, i18n.language)}</span>
                <Badge tone={tone(quotation.state)}>
                  {t(`billing.quotationState.${quotation.state}`)}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {openId ? <QuotationDetail id={openId} onClose={() => onOpen(null)} /> : null}
    </>
  );
}

function tone(state: QuotationView['state']) {
  if (state === 'accepted') return 'success' as const;
  if (state === 'declined') return 'danger' as const;
  if (state === 'expired') return 'warning' as const;
  if (state === 'sent') return 'accent' as const;
  return 'neutral' as const;
}

/**
 * Drafting a quotation (FR-30).
 *
 * The client and, if it was agreed, how long the offer stands. No reference
 * field: the number comes from the firm's own estimate sequence, continuing
 * from the 192 it had issued by hand, and asking somebody to type one is how
 * that sequence acquires a gap or a duplicate.
 *
 * It opens empty on purpose. A quotation with no lines is not an offer and
 * the aggregate refuses to send one, so the next thing to do is add what is
 * being quoted for — which is the screen this drops you into.
 */
function NewQuotation({ onDrafted }: { onDrafted: (id: string) => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const clients = useQuery({ queryKey: ['clients'], queryFn: listClients, enabled: open });

  const draft = useMutation({
    mutationFn: () => draftQuotation({ clientId, ...(validUntil ? { validUntil } : {}) }),
    onSuccess: (quotation) => {
      void queries.invalidateQueries({ queryKey: ['billing', 'quotations'] });
      setOpen(false);
      setClientId('');
      setValidUntil('');
      onDrafted(quotation.id);
    },
  });

  if (!open) {
    return (
      <div className="u-row">
        <Button onClick={() => setOpen(true)}>{t('billing.newQuotation.open')}</Button>
      </div>
    );
  }

  return (
    <Card title={t('billing.newQuotation.title')} description={t('billing.newQuotation.hint')}>
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          if (clientId) draft.mutate();
        }}
      >
        <Field
          label={t('billing.newQuotation.client')}
          control={(props) => (
            <Select
              {...props}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">{t('billing.newQuotation.chooseClient')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.legalName}
                </option>
              ))}
            </Select>
          )}
        />

        <Field
          label={t('billing.newQuotation.validUntil')}
          hint={t('billing.newQuotation.validUntilHint')}
          type="date"
          value={validUntil}
          onChange={(event) => setValidUntil(event.target.value)}
        />

        {draft.isError ? <Alert tone="error">{(draft.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={draft.isPending} disabled={!clientId}>
            {t('billing.newQuotation.submit')}
          </Button>
          <Button tone="quiet" onClick={() => setOpen(false)}>
            {t('billing.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function QuotationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const [printing, setPrinting] = useState(false);
  const profile = useQuery({ queryKey: ['billing', 'firm-profile'], queryFn: firmProfile });

  const list = useQuery({ queryKey: ['billing', 'quotations'], queryFn: () => fetchQuotations() });
  const quotation = list.data?.find((candidate) => candidate.id === id);

  const refresh = () => queries.invalidateQueries({ queryKey: ['billing', 'quotations'] });
  const answer = useMutation({
    mutationFn: (command: { act: 'send' | 'accept' | 'decline'; deliver?: boolean }) =>
      answerQuotation(id, command.act, command.deliver ? { deliver: true } : {}),
    onSuccess: () => void refresh(),
  });
  const removeLine = useMutation({
    mutationFn: (lineId: string) => removeQuotationLine(id, lineId),
    onSuccess: () => void refresh(),
  });

  if (!quotation) return <Loading label={t('loading')} />;
  const editable = quotation.state === 'draft';

  return (
    <Card title={quotation.reference} description={quotation.clientName ?? quotation.clientId}>
      <div className="u-row">
        <Button small tone="quiet" onClick={onClose}>
          {t('billing.close')}
        </Button>
        <Button small tone="secondary" onClick={() => setPrinting(!printing)}>
          {t('billing.print')}
        </Button>

        {/*
         * Two actions, because they are two different claims. Emailing it
         * queues a message to the client's own address and writes the
         * contact log; marking it sent records that somebody printed it and
         * handed it over, which is how half of these go out. "Sent" used to
         * mean only that a button had been pressed.
         */}
        {editable ? (
          <>
            <Button
              small
              busy={answer.isPending}
              onClick={() => answer.mutate({ act: 'send', deliver: true })}
            >
              {t('billing.emailQuotation')}
            </Button>
            <Button
              small
              tone="secondary"
              busy={answer.isPending}
              onClick={() => answer.mutate({ act: 'send' })}
            >
              {t('billing.markSent')}
            </Button>
          </>
        ) : null}

        {/*
          Accept and decline appear only while the offer is actually with the
          client. An expired quotation offers neither: the honest move is to
          re-quote rather than stand behind a price that lapsed.
        */}
        {quotation.state === 'sent' ? (
          <>
            <Button small busy={answer.isPending} onClick={() => answer.mutate({ act: 'accept' })}>
              {t('billing.clientAccepted')}
            </Button>
            <Button
              small
              tone="quiet"
              busy={answer.isPending}
              onClick={() => answer.mutate({ act: 'decline' })}
            >
              {t('billing.clientDeclined')}
            </Button>
          </>
        ) : null}
      </div>

      {/* What gets printed is what is on the screen, so nobody sends a client
          a document they were not looking at. */}
      {printing && profile.data ? (
        <QuotationDocument quotation={quotation} profile={profile.data} />
      ) : null}

      {answer.isError ? <Alert tone="error">{(answer.error as Error).message}</Alert> : null}
      {quotation.state === 'expired' ? (
        <Alert tone="warning">{t('billing.quotationExpired')}</Alert>
      ) : null}
      {quotation.sentAt && quotation.sentVia ? (
        <p className="u-text-soft">
          {t(`billing.sentVia.${quotation.sentVia}`)}{' '}
          <span className="u-ltr">{quotation.sentAt.slice(0, 10)}</span>
        </p>
      ) : null}
      {quotation.validUntil ? (
        <p className="u-text-soft">
          {t('billing.validUntil')}: <span className="u-ltr">{quotation.validUntil}</span>
        </p>
      ) : null}

      <ol className="u-stack-tight lines">
        {quotation.lines.map((line) => (
          <li key={line.id} className="u-row u-spread">
            <span className="row__main">
              <span className="u-typed">
                {i18n.language === 'ar'
                  ? line.descriptionAr || line.descriptionEn
                  : line.descriptionEn || line.descriptionAr}
              </span>
              {/* How it was priced, not only what it comes to: a fixed fee
                  accepted at 5,000 is still 5,000 when the work runs long. */}
              {line.kind === 'hours' && line.perHour ? (
                <span className="u-text-faint">
                  {t('billing.hoursAt', {
                    hours: line.hours,
                    rate: formatMoney(line.perHour, i18n.language),
                  })}
                </span>
              ) : (
                <span className="u-text-faint">{t('billing.fixedFee')}</span>
              )}
            </span>
            <span className="u-row u-row--tight">
              {/*
                What the line charges, with the parts beneath it when there
                are any. A single figure would hide both the discount the
                firm allowed and whether VAT was on it, and those are the two
                things anybody asks about a line afterwards.
              */}
              <span className="line__charge">
                <span className="u-numeric">{formatMoney(line.chargeable, i18n.language)}</span>
                {line.discount.minorUnits > 0 || line.vatBasisPoints !== null ? (
                  <span className="u-text-faint u-numeric">
                    {line.discount.minorUnits > 0
                      ? t('billing.lessDiscount', {
                          amount: formatMoney(line.discount, i18n.language),
                        })
                      : null}
                    {line.discount.minorUnits > 0 && line.vatBasisPoints !== null ? ' · ' : null}
                    {line.vatBasisPoints !== null
                      ? t('billing.plusVat', {
                          rate: ratePercent(line.vatBasisPoints),
                          amount: formatMoney(line.vat, i18n.language),
                        })
                      : null}
                  </span>
                ) : null}
              </span>
              {editable ? (
                <Button
                  small
                  tone="quiet"
                  busy={removeLine.isPending}
                  onClick={() => removeLine.mutate(line.id)}
                >
                  {t('billing.removeLine')}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {/*
        The breakdown, in the order it happens: what was quoted, what came
        off, what VAT applied, what the client pays. Rows that would say
        nothing are left out — a quotation with no discount on it does not
        need a line saying so.
      */}
      <div className="totals">
        {quotation.discount.minorUnits > 0 ? (
          <>
            <span>
              <span className="u-text-faint">{t('billing.subtotal')}</span>
              <span className="u-numeric">{formatMoney(quotation.subtotal, i18n.language)}</span>
            </span>
            <span>
              <span className="u-text-faint">{t('billing.discount')}</span>
              <span className="u-numeric">{formatMoney(quotation.discount, i18n.language)}</span>
            </span>
          </>
        ) : null}
        {quotation.vat.minorUnits > 0 ? (
          <>
            <span>
              <span className="u-text-faint">{t('billing.net')}</span>
              <span className="u-numeric">{formatMoney(quotation.net, i18n.language)}</span>
            </span>
            <span>
              <span className="u-text-faint">{t('billing.vat')}</span>
              <span className="u-numeric">{formatMoney(quotation.vat, i18n.language)}</span>
            </span>
          </>
        ) : null}
        <span>
          <span className="u-text-faint">{t('billing.chargeable')}</span>
          <strong className="u-numeric">{formatMoney(quotation.total, i18n.language)}</strong>
        </span>
      </div>

      {editable ? (
        <AddLine
          quotationId={id}
          vatBasisPoints={profile.data?.vatBasisPoints ?? null}
          onAdded={refresh}
        />
      ) : null}
    </Card>
  );
}

/**
 * A line: what service, priced how, less what, plus what VAT (item 13).
 *
 * The service comes first because it fills the description in both languages
 * — the firm's own words for the eleven things it sells, rather than whatever
 * somebody typed this time — and because a line that names its service can
 * later open the project for it. It stays editable afterwards: "VAT return"
 * usually wants a quarter after it.
 */
function AddLine({
  quotationId,
  vatBasisPoints,
  onAdded,
}: {
  quotationId: string;
  /**
   * The firm's own rate, so the choice on screen names the real one. Null
   * until the profile has answered — the form still works, it simply says
   * "VAT" rather than naming a rate it does not yet know.
   */
  vatBasisPoints: number | null;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'hours' | 'fixed'>('fixed');
  const [serviceCode, setServiceCode] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const [vat, setVat] = useState<'standard' | 'out_of_scope'>('standard');
  const services = useServices();

  const add = useMutation({
    mutationFn: (line: Parameters<typeof addQuotationLine>[1]) =>
      addQuotationLine(quotationId, line),
    onSuccess: () => {
      onAdded();
      setServiceCode('');
      setDescriptionEn('');
      setDescriptionAr('');
      setHours('');
      setRate('');
      setAmount('');
      setDiscount('');
      // The VAT choice is left where it was: a quotation is usually all one
      // or all the other, and re-picking it on every line is how the wrong
      // one gets picked.
    },
  });

  const rateMinor = minorUnitsFrom(rate);
  const amountMinor = minorUnitsFrom(amount);
  const discountMinor = discount.trim() === '' ? 0 : minorUnitsFrom(discount);
  const hoursValue = Number(hours);
  const hoursOk = hours.trim() !== '' && Number.isFinite(hoursValue) && hoursValue > 0;
  const described = descriptionEn.trim() !== '' || descriptionAr.trim() !== '';
  const priced = kind === 'hours' ? hoursOk && rateMinor !== null : amountMinor !== null;

  /*
   * What the line is worth before the discount, worked out here only to catch
   * a discount bigger than the line before the server has to. Both of these
   * come from whole minor units, so no float is involved; the figure the
   * client sees still comes back from the server.
   */
  const lineMinor =
    kind === 'hours'
      ? rateMinor === null || !hoursOk
        ? null
        : Math.round((rateMinor * Math.round(hoursValue * 100)) / 100)
      : amountMinor;
  const discountTooBig = discountMinor !== null && lineMinor !== null && discountMinor > lineMinor;
  const discountOk = discountMinor !== null && !discountTooBig;

  /** Picking a service writes the firm's own words for it into both fields. */
  const chooseService = (code: string) => {
    setServiceCode(code);
    if (code === '') return;
    setDescriptionEn(t(`services.${code}`, { lng: 'en' }));
    setDescriptionAr(t(`services.${code}`, { lng: 'ar' }));
  };

  return (
    <form
      className="u-stack-tight"
      onSubmit={(event) => {
        event.preventDefault();
        if (!described || !priced || !discountOk) return;
        add.mutate({
          ...(serviceCode ? { serviceCode } : {}),
          descriptionEn: descriptionEn.trim(),
          descriptionAr: descriptionAr.trim(),
          ...(kind === 'hours'
            ? { hours: hoursValue, perHourMinor: rateMinor as number }
            : { amountMinor: amountMinor as number }),
          ...(discountMinor ? { discountMinor } : {}),
          vat,
        });
      }}
    >
      <strong>{t('billing.addLine')}</strong>

      <div className="u-row tabs">
        {(['fixed', 'hours'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={`tab${kind === which ? ' tab--active' : ''}`}
            aria-pressed={kind === which}
            onClick={() => setKind(which)}
          >
            {t(`billing.priceBy.${which}`)}
          </button>
        ))}
      </div>

      {/* The services the projects section already offers, so a quotation
          and the project eventually opened for it name the same thing. */}
      <Field
        label={t('billing.lineService')}
        hint={t('billing.lineServiceHint')}
        control={(props) => (
          <Select
            {...props}
            value={serviceCode}
            onChange={(event) => chooseService(event.target.value)}
          >
            <option value="">{t('billing.lineServiceNone')}</option>
            {services.live.map((offered) => (
              <option key={offered.code} value={offered.code}>
                {t(`services.${offered.code}`)}
              </option>
            ))}
          </Select>
        )}
      />

      <Field
        label={t('billing.descriptionEn')}
        value={descriptionEn}
        onChange={(event) => setDescriptionEn(event.target.value)}
      />
      <Field
        label={t('billing.descriptionAr')}
        value={descriptionAr}
        onChange={(event) => setDescriptionAr(event.target.value)}
      />

      {kind === 'hours' ? (
        <>
          <Field
            label={t('billing.estimatedHours')}
            inputMode="decimal"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
          <Field
            label={t('billing.hourlyRate')}
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            {...(rate.trim() !== '' && rateMinor === null
              ? { error: t('billing.notAnAmount') }
              : {})}
          />
        </>
      ) : (
        <Field
          label={t('billing.fixedAmount')}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          {...(amount.trim() !== '' && amountMinor === null
            ? { error: t('billing.notAnAmount') }
            : {})}
        />
      )}

      <Field
        label={t('billing.lineDiscount')}
        hint={t('billing.lineDiscountHint')}
        inputMode="decimal"
        value={discount}
        onChange={(event) => setDiscount(event.target.value)}
        {...(discount.trim() !== '' && discountMinor === null
          ? { error: t('billing.notAnAmount') }
          : discountTooBig
            ? // Caught here as well as on the server: a discount bigger than
              // the line charges less than nothing, and finding that out
              // after pressing the button is a worse way to learn it.
              { error: t('billing.discountTooBig') }
            : {})}
      />

      {/*
        Five percent or out of scope, which is what the firm asked for. The
        rate is named from the server's own configuration rather than written
        into the screen, so a selector cannot promise a rate the firm does
        not charge.
      */}
      <Field
        label={t('billing.lineVat')}
        control={(props) => (
          <Select
            {...props}
            value={vat}
            onChange={(event) => setVat(event.target.value as 'standard' | 'out_of_scope')}
          >
            <option value="standard">
              {vatBasisPoints === null
                ? t('billing.vatStandardPlain')
                : t('billing.vatStandard', { rate: ratePercent(vatBasisPoints) })}
            </option>
            <option value="out_of_scope">{t('billing.vatOutOfScope')}</option>
          </Select>
        )}
      />
      {vat === 'standard' && vatBasisPoints === 0 ? (
        /*
         * The firm is configured as not registered for VAT. Said out loud
         * rather than silently quoting nothing: the difference between a
         * five percent line and a zero percent one is invisible on the
         * document and worth five percent of the invoice.
         */
        <Alert tone="warning">{t('billing.vatNotConfigured')}</Alert>
      ) : null}

      {add.isError ? <Alert tone="error">{(add.error as Error).message}</Alert> : null}

      <div className="u-row">
        <Button
          type="submit"
          small
          busy={add.isPending}
          disabled={!described || !priced || !discountOk}
        >
          {t('billing.addLine')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Basis points as a person reads them: 500 is "5", 475 is "4.75".
 *
 * Only ever for a label. Every figure on this screen was worked out on the
 * server, where the rounding rule lives.
 */
function ratePercent(basisPoints: number): string {
  return (basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2);
}
