import type { ClientDetail, DocumentSummary, TaskSummary } from '@amc/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, Loading } from '../../design/index.js';
import { documentLink } from '../documents/api.js';
import { DocumentUpload } from '../documents/document-upload.js';
import { StartTimerButton } from '../timer/timer-page.js';
import { getClient } from './api.js';

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The client file: who they are, what we hold, and what is outstanding. */
export function ClientPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const client = useQuery({ queryKey: ['clients', id], queryFn: () => getClient(id) });

  if (client.isLoading) return <Loading label={t('loading')} />;
  if (client.isError) return <p className="alert alert--error">{t('clients.failed')}</p>;
  if (!client.data) return <Empty title={t('clients.notFound')} />;

  const months = i18n.language === 'ar' ? MONTHS_AR : MONTHS_EN;
  const detail = client.data;

  return (
    <div className="u-stack">
      <div className="u-row">
        <Button tone="quiet" small onClick={onBack}>
          {t('clients.back')}
        </Button>
      </div>

      <div className="u-stack-tight">
        <h1>{detail.legalNameArabic ?? detail.legalName}</h1>
        {detail.legalNameArabic ? <p className="u-text-soft u-ltr">{detail.legalName}</p> : null}
      </div>

      <Card title={t('clients.taxDetails')}>
        <dl className="facts">
          <Fact label={t('clients.vatNumber')} value={detail.vatTrn} mono />
          <Fact
            label={t('clients.vatPeriods')}
            /*
             * Which months this client's quarters end in, shown plainly.
             * The authority staggers these per business, so a screen that
             * said only "quarterly" would leave everyone assuming calendar
             * quarters, which is wrong for most clients.
             */
            value={
              detail.vatPeriodEndMonths.length > 0
                ? detail.vatPeriodEndMonths
                    .map((month) => months[month - 1] ?? '?')
                    // The separator is translated: Arabic uses ، and English a
                    // comma, and hardcoding either shows the wrong one in half
                    // the interface.
                    .join(t('listSeparator'))
                : null
            }
          />
          <Fact label={t('clients.ctNumber')} value={detail.ctTrn} mono />
          <Fact
            label={t('clients.financialYear')}
            value={
              detail.financialYearEndMonth
                ? (months[detail.financialYearEndMonth - 1] ?? null)
                : null
            }
          />
          <Fact label={t('clients.licence')} value={detail.tradeLicenceNumber} mono />
          <Fact
            label={t('clients.rate')}
            value={detail.currentRate ? `${detail.currentRate} AED` : null}
          />
        </dl>
      </Card>

      <Card title={t('clients.documents')} description={t('clients.documentsHint')}>
        {detail.documents.length === 0 ? (
          <Empty title={t('clients.noDocuments')} />
        ) : (
          <div className="u-stack-tight">
            {detail.documents.map((document) => (
              <DocumentRow key={document.id} document={document} />
            ))}
          </div>
        )}
      </Card>

      <Card title={t('documents.add')} description={t('documents.addHint')}>
        <DocumentUpload
          clientId={id}
          onUploaded={(documents) =>
            // The server hands back the client's whole current document list,
            // so the section above is right immediately rather than after a
            // refetch that might race the one already in flight.
            queries.setQueryData(['clients', id], (previous: ClientDetail | undefined) =>
              previous ? { ...previous, documents } : previous,
            )
          }
        />
      </Card>

      <Card title={t('clients.work')}>
        {detail.tasks.length === 0 ? (
          <Empty title={t('clients.noWork')} />
        ) : (
          <div className="u-stack-tight">
            {detail.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="fact">
      <dt className="u-text-faint">{label}</dt>
      <dd className={mono ? 'u-ltr u-mono' : undefined}>{value ?? '—'}</dd>
    </div>
  );
}

function DocumentRow({ document }: { document: DocumentSummary }) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  /*
   * The link is fetched when it is wanted rather than sent with the list.
   * A link minted for every row would start expiring the moment the page
   * loaded, and most of them would never be used.
   */
  async function open() {
    setOpening(true);
    setFailed(false);
    try {
      const url = await documentLink(document.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  const tone =
    document.expiryState === 'expired'
      ? 'danger'
      : document.expiryState === 'expiring'
        ? 'warning'
        : undefined;

  return (
    <div className="line">
      <span>{t(`documentTypes.${document.type}`)}</span>
      <span className="u-grow" />
      {document.status === 'required' ? <Badge tone="warning">{t('clients.awaited')}</Badge> : null}
      {failed ? <span className="u-danger">{t('documents.openFailed')}</span> : null}
      {document.expiresOn ? (
        <>
          <span className="u-text-faint u-ltr u-numeric">{document.expiresOn}</span>
          {tone ? (
            <Badge tone={tone}>
              {document.expiryState === 'expired'
                ? t('clients.expired')
                : t('clients.expiresIn', { days: document.daysUntilExpiry })}
            </Badge>
          ) : null}
        </>
      ) : null}
      {document.status !== 'required' ? (
        <Button small tone="quiet" busy={opening} onClick={() => void open()}>
          {opening ? t('documents.opening') : t('documents.open')}
        </Button>
      ) : null}
    </div>
  );
}

function TaskRow({ task }: { task: TaskSummary }) {
  const { t } = useTranslation();

  return (
    <div className="line">
      <span>{t(`services.${task.service}`)}</span>
      {task.periodKey ? <span className="u-text-faint u-ltr">{task.periodKey}</span> : null}
      <span className="u-grow" />
      {task.missingDocuments.length > 0 ? (
        <Badge tone="warning">
          {t('clients.missingDocuments', { count: task.missingDocuments.length })}
        </Badge>
      ) : null}
      {task.dueAt ? (
        <span className={`u-ltr u-numeric ${task.isOverdue ? 'u-danger' : 'u-text-faint'}`}>
          {task.dueAt.slice(0, 10)}
        </span>
      ) : null}
      <Badge>{t(`taskStates.${task.state}`)}</Badge>
      {OPEN_STATES.has(task.state) ? <StartTimerButton taskId={task.id} /> : null}
    </div>
  );
}

/*
 * Time is recordable against any task that has not been closed. A task waiting
 * on the client or on the authority still costs the person chasing it, and
 * that hour is as billable as any other.
 */
const OPEN_STATES: ReadonlySet<TaskSummary['state']> = new Set([
  'awaiting_documents',
  'ready',
  'in_progress',
  'waiting_for_client',
  'waiting_for_authority',
]);
