import type { HoursRow, ProfitabilityRow } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Empty, Field, Loading } from '../../design/index.js';
import { type Period, hoursReport, profitabilityReport } from './api.js';
import { formatHours, formatMoney } from './money.js';

const GROUPINGS = ['client', 'person', 'service'] as const;
type Grouping = (typeof GROUPINGS)[number];

/** The current month, both ends inclusive, as a starting point. */
function thisMonth(): Period {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * The two month-end reports (FR-35).
 *
 * Every figure comes from the server. The browser does no arithmetic at all —
 * not even a total — because a total computed here would eventually disagree
 * with the statements it claims to summarise, and the disagreement would
 * surface in front of a client.
 */
export function Reports() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>(thisMonth);
  const [draft, setDraft] = useState<Period>(period);

  const valid = draft.from <= draft.to;

  return (
    <div className="u-stack">
      <Card title={t('billing.reports.title')} description={t('billing.reports.hint')}>
        <form
          className="u-row u-row--end"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) setPeriod(draft);
          }}
        >
          <Field
            label={t('billing.reports.from')}
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
          <Field
            label={t('billing.reports.to')}
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            {...(valid ? {} : { error: t('billing.reports.backwards') })}
          />
          <Button type="submit" disabled={!valid}>
            {t('billing.reports.run')}
          </Button>
        </form>
      </Card>

      <HoursPanel period={period} />
      <ProfitabilityPanel period={period} />
    </div>
  );
}

function HoursPanel({ period }: { period: Period }) {
  const { t, i18n } = useTranslation();
  const [by, setBy] = useState<Grouping>('client');

  const report = useQuery({
    queryKey: ['billing', 'reports', 'hours', period.from, period.to, by],
    queryFn: () => hoursReport(period, by),
  });

  return (
    <Card title={t('billing.reports.hours.title')} description={t('billing.reports.hours.hint')}>
      <div className="u-row tabs tabs--quiet">
        {GROUPINGS.map((which) => (
          <button
            key={which}
            type="button"
            className={`tab${by === which ? ' tab--active' : ''}`}
            aria-current={by === which ? 'page' : undefined}
            onClick={() => setBy(which)}
          >
            {t(`billing.reports.by.${which}`)}
          </button>
        ))}
      </div>

      {report.isLoading ? <Loading label={t('loading')} /> : null}
      {report.isError ? <Alert tone="error">{t('billing.failed')}</Alert> : null}
      {report.data && report.data.rows.length === 0 ? (
        <Empty
          title={t('billing.reports.hours.none')}
          description={t('billing.reports.hours.noneHint')}
        />
      ) : null}

      {report.data && report.data.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t(`billing.reports.of.${by}`)}</th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.hours.recorded')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.hours.billed')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.hours.unbilled')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.hours.charged')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((row) => (
                <HoursLine key={row.key} row={row} language={i18n.language} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t('billing.reports.total')}</th>
                <td className="table__figure u-numeric">
                  {formatHours(report.data.totals.recordedSeconds)}
                </td>
                <td className="table__figure u-numeric">
                  {formatHours(report.data.totals.billedSeconds)}
                </td>
                <td className="table__figure u-numeric">
                  {formatHours(report.data.totals.unbilledSeconds)}
                </td>
                <td className="table__figure u-numeric">
                  {formatMoney(report.data.totals.billedAmount, i18n.language)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function HoursLine({ row, language }: { row: HoursRow; language: string }) {
  const { t } = useTranslation();

  return (
    <tr>
      <th scope="row">{row.label}</th>
      <td className="table__figure u-numeric">{formatHours(row.recordedSeconds)}</td>
      <td className="table__figure u-numeric">{formatHours(row.billedSeconds)}</td>
      {/* Unbilled hours are the point of the report, so they are marked when
          there are any: work in progress and work given away look identical
          until somebody asks which this is. */}
      <td
        className={`table__figure u-numeric${row.unbilledSeconds > 0 ? ' u-warn' : ''}`}
        {...(row.unbilledSeconds > 0 ? { title: t('billing.reports.hours.unbilledHint') } : {})}
      >
        {formatHours(row.unbilledSeconds)}
      </td>
      <td className="table__figure u-numeric">{formatMoney(row.billedAmount, language)}</td>
    </tr>
  );
}

function ProfitabilityPanel({ period }: { period: Period }) {
  const { t, i18n } = useTranslation();
  const report = useQuery({
    queryKey: ['billing', 'reports', 'profitability', period.from, period.to],
    queryFn: () => profitabilityReport(period),
  });

  return (
    <Card title={t('billing.reports.profit.title')} description={t('billing.reports.profit.hint')}>
      {report.isLoading ? <Loading label={t('loading')} /> : null}
      {report.isError ? <Alert tone="error">{t('billing.failed')}</Alert> : null}
      {report.data && report.data.rows.length === 0 ? (
        <Empty title={t('billing.reports.profit.none')} />
      ) : null}

      {report.data && report.data.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('billing.reports.of.client')}</th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.hours.recorded')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.profit.net')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.profit.gross')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.profit.paid')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.profit.outstanding')}
                </th>
                <th scope="col" className="table__figure">
                  {t('billing.reports.profit.effective')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((row) => (
                <ProfitLine key={row.clientId} row={row} language={i18n.language} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function ProfitLine({ row, language }: { row: ProfitabilityRow; language: string }) {
  const { t } = useTranslation();

  /*
   * Below the client's own rate is the finding, not a failure.
   *
   * A fixed fee that took twice the hours expected earns half the rate, and
   * that is worth seeing at the moment the fee is renegotiated rather than a
   * year later. Marked, never hidden: the row still shows its figures.
   */
  const short =
    row.effectivePerHour !== null &&
    row.standardPerHour.minorUnits > 0 &&
    row.effectivePerHour.minorUnits < row.standardPerHour.minorUnits;

  return (
    <tr>
      <th scope="row">{row.clientName}</th>
      <td className="table__figure u-numeric">{formatHours(row.recordedSeconds)}</td>
      <td className="table__figure u-numeric">{formatMoney(row.netInvoiced, language)}</td>
      <td className="table__figure u-numeric">{formatMoney(row.grossInvoiced, language)}</td>
      <td className="table__figure u-numeric">{formatMoney(row.paid, language)}</td>
      <td className={`table__figure u-numeric${row.outstanding.minorUnits > 0 ? ' u-warn' : ''}`}>
        {formatMoney(row.outstanding, language)}
      </td>
      <td className={`table__figure u-numeric${short ? ' u-danger' : ''}`}>
        {row.effectivePerHour === null ? (
          /* No hours recorded. Dividing by nothing would print a triumph. */
          <span className="u-text-faint" title={t('billing.reports.profit.noHoursHint')}>
            {t('billing.reports.profit.noHours')}
          </span>
        ) : (
          <>
            {formatMoney(row.effectivePerHour, language)}
            {/* On its own line: the two rates side by side ran off the end of
                the table, and half a comparison is worse than none. */}
            <span className="u-block u-text-faint">
              {t('billing.reports.profit.against', {
                rate: formatMoney(row.standardPerHour, language),
              })}
            </span>
          </>
        )}
      </td>
    </tr>
  );
}
