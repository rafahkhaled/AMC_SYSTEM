import type { QuotationView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading } from '../../design/index.js';
import {
  addQuotationLine,
  answerQuotation,
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

function QuotationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const [printing, setPrinting] = useState(false);
  const profile = useQuery({ queryKey: ['billing', 'firm-profile'], queryFn: firmProfile });

  const list = useQuery({ queryKey: ['billing', 'quotations'], queryFn: () => fetchQuotations() });
  const quotation = list.data?.find((candidate) => candidate.id === id);

  const refresh = () => queries.invalidateQueries({ queryKey: ['billing', 'quotations'] });
  const answer = useMutation({
    mutationFn: (act: 'send' | 'accept' | 'decline') => answerQuotation(id, act),
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

        {editable ? (
          <Button small busy={answer.isPending} onClick={() => answer.mutate('send')}>
            {t('billing.sendQuotation')}
          </Button>
        ) : null}

        {/*
          Accept and decline appear only while the offer is actually with the
          client. An expired quotation offers neither: the honest move is to
          re-quote rather than stand behind a price that lapsed.
        */}
        {quotation.state === 'sent' ? (
          <>
            <Button small busy={answer.isPending} onClick={() => answer.mutate('accept')}>
              {t('billing.clientAccepted')}
            </Button>
            <Button
              small
              tone="quiet"
              busy={answer.isPending}
              onClick={() => answer.mutate('decline')}
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
      {quotation.validUntil ? (
        <p className="u-text-soft">
          {t('billing.validUntil')}: <span className="u-ltr">{quotation.validUntil}</span>
        </p>
      ) : null}

      <ol className="u-stack-tight lines">
        {quotation.lines.map((line) => (
          <li key={line.id} className="u-row u-spread">
            <span className="row__main">
              <span>
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
              <span className="u-numeric">{formatMoney(line.amount, i18n.language)}</span>
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

      <div className="totals">
        <span>
          <span className="u-text-faint">{t('billing.total')}</span>
          <strong className="u-numeric">{formatMoney(quotation.total, i18n.language)}</strong>
        </span>
      </div>

      {editable ? <AddLine quotationId={id} onAdded={refresh} /> : null}
    </Card>
  );
}

/** A line, priced by hours or as a fixed fee. Never both. */
function AddLine({ quotationId, onAdded }: { quotationId: string; onAdded: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'hours' | 'fixed'>('fixed');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');

  const add = useMutation({
    mutationFn: (line: Parameters<typeof addQuotationLine>[1]) =>
      addQuotationLine(quotationId, line),
    onSuccess: () => {
      onAdded();
      setDescriptionEn('');
      setDescriptionAr('');
      setHours('');
      setRate('');
      setAmount('');
    },
  });

  const rateMinor = minorUnitsFrom(rate);
  const amountMinor = minorUnitsFrom(amount);
  const hoursValue = Number(hours);
  const hoursOk = hours.trim() !== '' && Number.isFinite(hoursValue) && hoursValue > 0;
  const described = descriptionEn.trim() !== '' || descriptionAr.trim() !== '';
  const priced = kind === 'hours' ? hoursOk && rateMinor !== null : amountMinor !== null;

  return (
    <form
      className="u-stack-tight"
      onSubmit={(event) => {
        event.preventDefault();
        if (!described || !priced) return;
        add.mutate(
          kind === 'hours'
            ? {
                descriptionEn: descriptionEn.trim(),
                descriptionAr: descriptionAr.trim(),
                hours: hoursValue,
                perHourMinor: rateMinor as number,
              }
            : {
                descriptionEn: descriptionEn.trim(),
                descriptionAr: descriptionAr.trim(),
                amountMinor: amountMinor as number,
              },
        );
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

      {add.isError ? <Alert tone="error">{(add.error as Error).message}</Alert> : null}

      <div className="u-row">
        <Button type="submit" small busy={add.isPending} disabled={!described || !priced}>
          {t('billing.addLine')}
        </Button>
      </div>
    </form>
  );
}
