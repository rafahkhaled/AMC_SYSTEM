import type { CalendarEntry, Caller } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Loading } from '../design/index.js';
import { invoices as fetchInvoices } from '../features/billing/api.js';
import { formatMoney } from '../features/billing/money.js';
import { upcomingDeadlines } from '../features/calendar/api.js';
import { projectBoard } from '../features/projects/api.js';

/**
 * The first screen of the day (FR-80).
 *
 * Built around one question — what needs me today — rather than around what
 * the system happens to know. It showed a list of the caller's permission
 * strings before, which is a thing a developer wants to see once and an
 * accountant never does.
 *
 * Role-aware by leaving cards out rather than by emptying them. Somebody who
 * cannot see money should not be told there is a receivables card they are
 * not allowed to read.
 */
export function HomePage({
  caller,
  onOpenProject,
}: {
  caller: Caller;
  /** Absent where the shell has nowhere to send them. */
  onOpenProject?: ((id: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const canSeeBilling = caller.permissions.includes('billing.view');

  return (
    <div className="u-stack">
      <div className="u-stack-tight">
        <h1>{t('home.welcome', { name: caller.displayName })}</h1>
        <p className="u-text-soft">{t('home.hint')}</p>
      </div>

      <Deadlines onOpenProject={onOpenProject} />
      <WorkInHand onOpenProject={onOpenProject} />
      {canSeeBilling ? <CollectionPending /> : null}
    </div>
  );
}

/**
 * What is late, and what is coming (FR-80, FR-40).
 *
 * Overdue first and in its own tone, because the two are not the same
 * question: one is work to plan and the other is a conversation to have
 * today.
 */
function Deadlines({ onOpenProject }: { onOpenProject?: ((id: string) => void) | undefined }) {
  const { t } = useTranslation();
  const due = useQuery({ queryKey: ['home', 'deadlines'], queryFn: () => upcomingDeadlines(30) });

  if (due.isLoading) return <Loading label={t('loading')} />;
  if (due.isError) return null;

  const { overdue = [], soon = [] } = due.data ?? {};
  if (overdue.length === 0 && soon.length === 0) {
    return (
      <Card title={t('home.deadlines.title')}>
        <Empty title={t('home.deadlines.none')} description={t('home.deadlines.noneHint')} />
      </Card>
    );
  }

  return (
    <Card title={t('home.deadlines.title')} description={t('home.deadlines.hint')}>
      <div className="u-stack-tight">
        {overdue.map((entry) => (
          <DeadlineRow key={entry.id} entry={entry} late onOpenProject={onOpenProject} />
        ))}
        {soon.map((entry) => (
          <DeadlineRow key={entry.id} entry={entry} onOpenProject={onOpenProject} />
        ))}
      </div>
    </Card>
  );
}

function DeadlineRow({
  entry,
  late = false,
  onOpenProject,
}: {
  entry: CalendarEntry;
  late?: boolean;
  onOpenProject?: ((id: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const openable = entry.projectId !== null && onOpenProject !== undefined;

  const body = (
    <>
      <span className="row__main">
        <strong className="u-typed">{entry.clientName}</strong>
        <span className="u-text-faint">
          {t(`deadlineKinds.${entry.kind}`)}
          {entry.periodKey ? (
            <>
              {t('listSeparator')}
              <span className="u-ltr">{entry.periodKey}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="u-row u-row--tight">
        <span className={`u-ltr u-numeric ${late ? 'u-danger' : 'u-text-faint'}`}>
          {entry.dueOn}
        </span>
        {late ? <Badge tone="danger">{t('home.deadlines.overdue')}</Badge> : null}
      </span>
    </>
  );

  return openable ? (
    <button
      type="button"
      className="row row--button"
      onClick={() => onOpenProject?.(entry.projectId as string)}
    >
      {body}
    </button>
  ) : (
    <div className="row row--static">{body}</div>
  );
}

/** What is on this person's desk, by the state it is stuck in (FR-80). */
function WorkInHand({ onOpenProject }: { onOpenProject?: ((id: string) => void) | undefined }) {
  const { t } = useTranslation();
  const board = useQuery({ queryKey: ['projects'], queryFn: projectBoard });

  if (board.isLoading || board.isError) return null;

  const columns = board.data?.columns ?? [];
  const total = columns.reduce((count, column) => count + column.projects.length, 0);
  if (total === 0) {
    return (
      <Card title={t('home.work.title')}>
        <Empty title={t('home.work.none')} />
      </Card>
    );
  }

  const blocked = columns
    .filter((column) => column.state === 'awaiting_documents')
    .flatMap((column) => column.projects);

  return (
    <Card title={t('home.work.title')} description={t('home.work.hint', { count: total })}>
      <div className="u-row u-row--wrap">
        {columns
          .filter((column) => column.projects.length > 0)
          .map((column) => (
            <Badge key={column.state}>
              {t(`projectStates.${column.state}`)} · {column.projects.length}
            </Badge>
          ))}
      </div>

      {/* Named, not counted. "Three waiting on documents" is a number;
          "Gulf Trading is waiting on a trade licence" is something somebody
          can pick up the phone about. */}
      {blocked.length > 0 ? (
        <div className="u-stack-tight">
          {blocked.slice(0, 5).map((project) => (
            <button
              key={project.id}
              type="button"
              className="row row--button"
              onClick={() => onOpenProject?.(project.id)}
            >
              <span className="row__main">
                <strong className="u-typed">{project.clientName}</strong>
                <span className="u-text-faint">{t(`services.${project.service}`)}</span>
              </span>
              <Badge tone="warning">
                {t('clients.missingDocuments', { count: project.missingDocuments.length })}
              </Badge>
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
function CollectionPending() {
  const { t, i18n } = useTranslation();
  const list = useQuery({
    queryKey: ['billing', 'invoices', false],
    queryFn: () => fetchInvoices(false),
  });

  const pending = (list.data ?? []).filter((invoice) => invoice.collectionPending);
  if (list.isLoading || pending.length === 0) return null;

  return (
    <Card title={t('home.collectionPending')} description={t('home.collectionPendingHint')}>
      <div className="u-stack-tight">
        {pending.map((invoice) => (
          <div key={invoice.id} className="row row--static">
            <span className="row__main">
              <strong>{invoice.clientName ?? invoice.clientId}</strong>
              <span className="u-text-faint">
                <span className="u-ltr">{invoice.number}</span>
                {' · '}
                {t('billing.collectionPending', { count: invoice.openProjects })}
              </span>
            </span>
            <span className="u-numeric u-warn">{formatMoney(invoice.balance, i18n.language)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
