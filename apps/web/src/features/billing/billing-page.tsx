import type { InvoiceView, StatementView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading } from '../../design/index.js';
import {
  approve,
  invoices as fetchInvoices,
  statements as fetchStatements,
  raiseInvoice,
  recordPayment,
  reviseLine,
  statement as statementById,
} from './api.js';
import { formatHours, formatMoney, minorUnitsFrom } from './money.js';

/**
 * Billing (FR-31 to FR-33).
 *
 * Two lists and a review screen. The review is the part that has to be right:
 * it is where somebody decides what a client will actually be charged, and
 * every figure on it comes from the server rather than being recomputed here.
 * A browser that did its own arithmetic would eventually disagree with the
 * invoice, and the client would find the difference before the firm did.
 */
export function BillingPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'statements' | 'invoices'>('statements');
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="u-stack">
      <div className="u-row tabs">
        {(['statements', 'invoices'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={`tab${tab === which ? ' tab--active' : ''}`}
            aria-current={tab === which ? 'page' : undefined}
            onClick={() => {
              setTab(which);
              setOpenId(null);
            }}
          >
            {t(`billing.tabs.${which}`)}
          </button>
        ))}
      </div>

      {tab === 'statements' ? (
        <StatementList openId={openId} onOpen={setOpenId} />
      ) : (
        <InvoiceList openId={openId} onOpen={setOpenId} />
      )}
    </div>
  );
}

function StatementList({
  openId,
  onOpen,
}: {
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ['billing', 'statements'], queryFn: () => fetchStatements() });

  return (
    <>
      <Card title={t('billing.statements.title')} description={t('billing.statements.hint')}>
        {list.isLoading ? <Loading label={t('loading')} /> : null}
        {list.isError ? <Alert tone="error">{t('billing.failed')}</Alert> : null}
        {list.data && list.data.length === 0 ? (
          <Empty
            title={t('billing.statements.none')}
            description={t('billing.statements.noneHint')}
          />
        ) : null}

        <div className="u-stack-tight">
          {(list.data ?? []).map((statement) => (
            <StatementRow
              key={statement.id}
              statement={statement}
              open={statement.id === openId}
              onOpen={() => onOpen(statement.id === openId ? null : statement.id)}
            />
          ))}
        </div>
      </Card>

      {openId ? <StatementReview id={openId} onClose={() => onOpen(null)} /> : null}
    </>
  );
}

function StatementRow({
  statement,
  open,
  onOpen,
}: {
  statement: StatementView;
  open: boolean;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <button
      type="button"
      className={`row row--button${open ? ' row--open' : ''}`}
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className="row__main">
        <strong>{statement.clientName ?? statement.clientId}</strong>
        <span className="u-text-faint u-ltr">
          {statement.periodStart} — {statement.periodEnd}
        </span>
      </span>

      <span className="u-row u-row--tight">
        <span className="u-numeric">{formatMoney(statement.total, i18n.language)}</span>
        <Badge tone={stateTone(statement.state)}>{t(`billing.state.${statement.state}`)}</Badge>
      </span>
    </button>
  );
}

function stateTone(state: StatementView['state']) {
  if (state === 'approved') return 'success' as const;
  if (state === 'invoiced') return 'accent' as const;
  if (state === 'cancelled') return 'danger' as const;
  return 'neutral' as const;
}

/** The review: every line, what it was worth, and what it will be billed at. */
function StatementReview({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();

  const open = useQuery({
    queryKey: ['billing', 'statement', id],
    queryFn: () => statementById(id),
  });

  const settle = (next: StatementView) => {
    queries.setQueryData(['billing', 'statement', id], next);
    void queries.invalidateQueries({ queryKey: ['billing', 'statements'] });
    void queries.invalidateQueries({ queryKey: ['billing', 'invoices'] });
  };

  const approveIt = useMutation({ mutationFn: () => approve(id), onSuccess: settle });
  const invoiceIt = useMutation({
    mutationFn: () => raiseInvoice(id),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['billing'] });
      onClose();
    },
  });

  if (open.isLoading) return <Loading label={t('loading')} />;
  if (open.isError || !open.data) return <Alert tone="error">{t('billing.failed')}</Alert>;

  const statement = open.data;
  const editable = statement.state === 'draft';
  const written = statement.total.minorUnits !== statement.totalAsWorked.minorUnits;

  return (
    <Card
      title={statement.clientName ?? statement.clientId}
      description={`${statement.periodStart} — ${statement.periodEnd}`}
    >
      <div className="u-row">
        <Button small tone="quiet" onClick={onClose}>
          {t('billing.close')}
        </Button>

        {statement.state === 'draft' ? (
          <Button small busy={approveIt.isPending} onClick={() => approveIt.mutate()}>
            {t('billing.approve')}
          </Button>
        ) : null}

        {statement.state === 'approved' ? (
          <Button small busy={invoiceIt.isPending} onClick={() => invoiceIt.mutate()}>
            {t('billing.raiseInvoice')}
          </Button>
        ) : null}
      </div>

      {approveIt.isError ? <Alert tone="error">{(approveIt.error as Error).message}</Alert> : null}
      {invoiceIt.isError ? <Alert tone="error">{(invoiceIt.error as Error).message}</Alert> : null}

      <div className="totals">
        <span>
          <span className="u-text-faint">{t('billing.worked')}</span>
          <strong className="u-numeric">{formatHours(statement.workedSeconds)}</strong>
        </span>
        {/*
          What the clock said, shown beside what will be billed, and only when
          they differ. A reviewer's question is always about the gap; showing
          two identical figures teaches them to stop reading both.
        */}
        {written ? (
          <span>
            <span className="u-text-faint">{t('billing.asWorked')}</span>
            <strong className="u-numeric">
              {formatMoney(statement.totalAsWorked, i18n.language)}
            </strong>
          </span>
        ) : null}
        <span>
          <span className="u-text-faint">{t('billing.toBill')}</span>
          <strong className="u-numeric">{formatMoney(statement.total, i18n.language)}</strong>
        </span>
      </div>

      <div className="u-stack-tight">
        {statement.lines.map((line) => (
          <StatementLineRow
            key={line.id}
            statementId={id}
            line={line}
            editable={editable}
            onRevised={settle}
          />
        ))}
      </div>
    </Card>
  );
}

function StatementLineRow({
  statementId,
  line,
  editable,
  onRevised,
}: {
  statementId: string;
  line: StatementView['lines'][number];
  editable: boolean;
  onRevised: (next: StatementView) => void;
}) {
  const { t, i18n } = useTranslation();
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');

  const revise = useMutation({
    mutationFn: (body: { reason: string; adjustToMinor?: number }) =>
      reviseLine(statementId, line.id, body),
    onSuccess: (next) => {
      onRevised(next);
      setRevising(false);
      setReason('');
      setAmount('');
    },
  });

  /*
   * Intent and validity are different questions.
   *
   * Anything typed in the amount box means "adjust this line"; whether it
   * parses decides only whether the button works. Deriving the label from the
   * parsed value instead made it flip back to "Exclude line" the moment
   * somebody typed 1.234 — telling them it would take the line off the bill
   * when what they wanted was to change its figure.
   */
  const wantsToAdjust = amount.trim() !== '';
  const typedAmount = wantsToAdjust ? minorUnitsFrom(amount) : null;
  const amountIsWrong = wantsToAdjust && typedAmount === null;
  const canSubmit = reason.trim().length >= 3 && !amountIsWrong;

  return (
    <div className={`line${line.excluded ? ' line--excluded' : ''}`}>
      <div className="u-row u-spread">
        <span className="row__main">
          <strong>{line.service}</strong>
          <span className="u-text-faint">
            <span className="u-ltr">{line.performedOn}</span>
            {line.userName ? ` · ${line.userName}` : null}
            {` · ${formatHours(line.workedSeconds)} · ${formatMoney(line.perHour, i18n.language)}`}
          </span>
        </span>

        <span className="u-row u-row--tight">
          {/* The original struck through, so the change is visible rather than
              merely recorded somewhere. */}
          {line.amount.minorUnits !== line.asWorked.minorUnits ? (
            <s className="u-text-faint u-numeric">{formatMoney(line.asWorked, i18n.language)}</s>
          ) : null}
          <span className="u-numeric">{formatMoney(line.amount, i18n.language)}</span>
          {editable ? (
            <Button small tone="quiet" onClick={() => setRevising(!revising)}>
              {t('billing.revise')}
            </Button>
          ) : null}
        </span>
      </div>

      {line.excludedReason ? (
        <p className="u-text-soft">
          {t('billing.excludedBecause')}: {line.excludedReason}
        </p>
      ) : null}
      {line.adjustedReason ? (
        <p className="u-text-soft">
          {t('billing.adjustedBecause')}: {line.adjustedReason}
        </p>
      ) : null}

      {revising ? (
        <form
          className="u-stack-tight"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            revise.mutate(
              typedAmount === null
                ? { reason: reason.trim() }
                : { reason: reason.trim(), adjustToMinor: typedAmount },
            );
          }}
        >
          <Field
            label={t('billing.newAmount')}
            hint={t('billing.newAmountHint')}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            {...(amountIsWrong ? { error: t('billing.notAnAmount') } : {})}
          />
          <Field
            label={t('billing.reason')}
            hint={t('billing.reasonHint')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />

          {revise.isError ? <Alert tone="error">{(revise.error as Error).message}</Alert> : null}

          <div className="u-row">
            <Button type="submit" small busy={revise.isPending} disabled={!canSubmit}>
              {wantsToAdjust ? t('billing.adjustLine') : t('billing.excludeLine')}
            </Button>
            <Button small tone="quiet" onClick={() => setRevising(false)}>
              {t('billing.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function InvoiceList({
  openId,
  onOpen,
}: {
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const list = useQuery({
    queryKey: ['billing', 'invoices', outstandingOnly],
    queryFn: () => fetchInvoices(outstandingOnly),
  });

  return (
    <>
      <Card title={t('billing.invoices.title')} description={t('billing.invoices.hint')}>
        <div className="u-row">
          <Button
            small
            tone={outstandingOnly ? 'primary' : 'quiet'}
            onClick={() => setOutstandingOnly(!outstandingOnly)}
          >
            {t('billing.outstandingOnly')}
          </Button>
        </div>

        {list.isLoading ? <Loading label={t('loading')} /> : null}
        {list.isError ? <Alert tone="error">{t('billing.failed')}</Alert> : null}
        {list.data && list.data.length === 0 ? <Empty title={t('billing.invoices.none')} /> : null}

        <div className="u-stack-tight">
          {(list.data ?? []).map((invoice) => (
            <button
              key={invoice.id}
              type="button"
              className={`row row--button${invoice.id === openId ? ' row--open' : ''}`}
              aria-expanded={invoice.id === openId}
              onClick={() => onOpen(invoice.id === openId ? null : invoice.id)}
            >
              <span className="row__main">
                <strong className="u-ltr">{invoice.number}</strong>
                <span className="u-text-faint">{invoice.clientName ?? invoice.clientId}</span>
              </span>
              <span className="u-row u-row--tight">
                <span className="u-numeric">{formatMoney(invoice.total, i18n.language)}</span>
                {invoice.balance.minorUnits > 0 ? (
                  <span className="u-text-faint u-numeric">
                    {t('billing.owing')} {formatMoney(invoice.balance, i18n.language)}
                  </span>
                ) : null}
                <Badge tone={statusTone(invoice.status)}>
                  {t(`billing.status.${invoice.status}`)}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {openId ? <InvoiceDetail id={openId} onClose={() => onOpen(null)} /> : null}
    </>
  );
}

function statusTone(status: InvoiceView['status']) {
  if (status === 'paid') return 'success' as const;
  if (status === 'overdue') return 'danger' as const;
  if (status === 'part_paid') return 'warning' as const;
  if (status === 'cancelled') return 'neutral' as const;
  return 'accent' as const;
}

function InvoiceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');

  const list = useQuery({
    queryKey: ['billing', 'invoices', false],
    queryFn: () => fetchInvoices(false),
  });
  const invoice = list.data?.find((candidate) => candidate.id === id);

  const pay = useMutation({
    mutationFn: (body: { amountMinor: number; receivedOn: string; method: string }) =>
      recordPayment(id, body),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['billing'] });
      setAmount('');
      setReference('');
    },
  });

  if (!invoice) return <Loading label={t('loading')} />;

  const typedAmount = minorUnitsFrom(amount);
  const amountIsWrong = amount.trim() !== '' && typedAmount === null;
  const settled = invoice.balance.minorUnits === 0;

  return (
    <Card title={invoice.number} description={invoice.clientName ?? invoice.clientId}>
      <div className="u-row">
        <Button small tone="quiet" onClick={onClose}>
          {t('billing.close')}
        </Button>
      </div>

      {invoice.overdueSince ? (
        <Alert tone="warning">
          {t('billing.overdueSince', { date: invoice.overdueSince.slice(0, 10) })}
        </Alert>
      ) : null}

      <div className="totals">
        <span>
          <span className="u-text-faint">{t('billing.net')}</span>
          <strong className="u-numeric">{formatMoney(invoice.net, i18n.language)}</strong>
        </span>
        <span>
          <span className="u-text-faint">{t('billing.vat')}</span>
          <strong className="u-numeric">{formatMoney(invoice.vat, i18n.language)}</strong>
        </span>
        <span>
          <span className="u-text-faint">{t('billing.total')}</span>
          <strong className="u-numeric">{formatMoney(invoice.total, i18n.language)}</strong>
        </span>
        <span>
          <span className="u-text-faint">{t('billing.owing')}</span>
          <strong className="u-numeric">{formatMoney(invoice.balance, i18n.language)}</strong>
        </span>
      </div>

      <ol className="u-stack-tight lines">
        {invoice.lines.map((line) => (
          <li key={line.id} className="u-row u-spread">
            <span>{i18n.language === 'ar' ? line.descriptionAr : line.descriptionEn}</span>
            <span className="u-numeric">{formatMoney(line.amount, i18n.language)}</span>
          </li>
        ))}
      </ol>

      {invoice.payments.length > 0 ? (
        <div className="u-stack-tight">
          <strong>{t('billing.payments')}</strong>
          {invoice.payments.map((payment) => (
            <div key={payment.id} className="u-row u-spread">
              <span className="u-text-faint">
                <span className="u-ltr">{payment.receivedOn.slice(0, 10)}</span>
                {` · ${t(`billing.method.${payment.method}`)}`}
                {payment.reference ? ` · ${payment.reference}` : null}
              </span>
              <span className="u-numeric">{formatMoney(payment.amount, i18n.language)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {settled ? null : (
        <form
          className="u-stack-tight"
          onSubmit={(event) => {
            event.preventDefault();
            if (typedAmount === null) return;
            pay.mutate({
              amountMinor: typedAmount,
              receivedOn: new Date().toISOString(),
              method,
            });
          }}
        >
          <Field
            label={t('billing.amountReceived')}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            {...(amountIsWrong ? { error: t('billing.notAnAmount') } : {})}
          />
          <Field
            label={t('billing.method.label')}
            control={(props) => (
              <select
                {...props}
                className="input"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {(['bank_transfer', 'cheque', 'cash', 'card', 'other'] as const).map((which) => (
                  <option key={which} value={which}>
                    {t(`billing.method.${which}`)}
                  </option>
                ))}
              </select>
            )}
          />
          <Field
            label={t('billing.reference')}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />

          {pay.isError ? <Alert tone="error">{(pay.error as Error).message}</Alert> : null}

          <div className="u-row">
            <Button type="submit" small busy={pay.isPending} disabled={typedAmount === null}>
              {t('billing.recordPayment')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
