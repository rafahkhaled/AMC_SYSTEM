import type { TaskDetail, TaskStateName } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { StartTimerButton } from '../timer/timer-page.js';
import { attachDocument, completeStep, moveTask, taskDetail } from './api.js';

/** One piece of work: where it has got to, what it is waiting on, what is next. */
export function TaskPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const task = useQuery({ queryKey: ['task', id], queryFn: () => taskDetail(id) });

  const settle = (next: TaskDetail) => {
    queries.setQueryData(['task', id], next);
    // The board's columns and counts are wrong the moment this changes.
    void queries.invalidateQueries({ queryKey: ['tasks'] });
  };

  const move = useMutation({
    mutationFn: (to: TaskStateName) => moveTask(id, to),
    onSuccess: settle,
  });
  const step = useMutation({
    mutationFn: (order: number) => completeStep(id, order),
    onSuccess: settle,
  });
  const attach = useMutation({
    mutationFn: ({ type, documentId }: { type: string; documentId: string }) =>
      attachDocument(id, type, documentId),
    onSuccess: settle,
  });

  if (task.isLoading) return <Loading label={t('loading')} />;
  if (task.isError || !task.data) return <p className="alert alert--error">{t('tasks.failed')}</p>;

  const detail = task.data;
  const refusal = move.error ?? step.error ?? attach.error;
  const arabic = i18n.language === 'ar';

  return (
    <div className="u-stack">
      <button type="button" className="link-button" onClick={onBack}>
        {t('back')}
      </button>

      <header className="u-stack-tight">
        <h1>{detail.clientName}</h1>
        <div className="u-row">
          <span className="u-text-soft">{t(`services.${detail.service}`)}</span>
          {detail.periodKey ? <span className="u-text-faint u-ltr">{detail.periodKey}</span> : null}
          <Badge>{t(`taskStates.${detail.state}`)}</Badge>
          {detail.isOverdue ? <Badge tone="danger">{t('tasks.overdue')}</Badge> : null}
        </div>
      </header>

      {refusal ? <Alert tone="error">{refusal.message}</Alert> : null}

      <Card title={t('tasks.whatNext')} description={t('tasks.whatNextHint')}>
        <div className="u-row u-wrap">
          {detail.allowedTransitions.length === 0 ? (
            <p className="u-text-faint">{t('tasks.closed')}</p>
          ) : (
            detail.allowedTransitions.map((state) => {
              /*
               * The lifecycle says a ready task may start; the document gate
               * says this one may not yet. Both are real rules and neither
               * belongs to the other, so the button stays visible — hiding it
               * would leave someone wondering where starting went — and says
               * why it cannot be pressed instead of waiting to be pressed and
               * then refusing.
               */
              const blocked = state === 'in_progress' && detail.missingDocuments.length > 0;
              return (
                <Button
                  key={state}
                  tone={state === 'cancelled' ? 'quiet' : 'secondary'}
                  small
                  busy={move.isPending}
                  disabled={blocked}
                  title={
                    blocked
                      ? t('tasks.blockedBy', {
                          documents: detail.missingDocuments
                            .map((type) => t(`documentTypes.${type}`))
                            .join(t('listSeparator')),
                        })
                      : undefined
                  }
                  onClick={() => move.mutate(state)}
                >
                  {t(`taskStates.${state}`)}
                </Button>
              );
            })
          )}
          <span className="u-grow" />
          {detail.state === 'in_progress' ? <StartTimerButton taskId={detail.id} /> : null}
        </div>
      </Card>

      <Card title={t('tasks.documents')} description={t('tasks.documentsHint')}>
        {detail.requirements.length === 0 ? (
          <p className="u-text-faint">{t('tasks.noDocumentsNeeded')}</p>
        ) : (
          detail.requirements.map((requirement) => {
            const candidates = detail.availableDocuments.filter(
              (document) => document.type === requirement.type,
            );
            return (
              <div key={requirement.type} className="line">
                <span>{t(`documentTypes.${requirement.type}`)}</span>
                {requirement.mandatory ? <Badge>{t('tasks.mandatory')}</Badge> : null}
                <span className="u-grow" />
                {requirement.documentId ? (
                  <>
                    <Badge tone="success">{t('tasks.attached')}</Badge>
                    {requirement.documentExpiresOn ? (
                      <span className="u-text-faint u-ltr u-numeric">
                        {requirement.documentExpiresOn.slice(0, 10)}
                      </span>
                    ) : null}
                  </>
                ) : candidates.length > 0 ? (
                  <Button
                    small
                    tone="secondary"
                    busy={attach.isPending}
                    onClick={() =>
                      attach.mutate({
                        type: requirement.type,
                        documentId: candidates[0]?.id ?? '',
                      })
                    }
                  >
                    {t('tasks.attachHeld')}
                  </Button>
                ) : (
                  <Badge tone="warning">{t('tasks.notHeld')}</Badge>
                )}
              </div>
            );
          })
        )}
      </Card>

      <Card title={t('tasks.steps')} description={t('tasks.stepsHint')}>
        {detail.steps.map((item) => (
          <div key={item.order} className="line">
            <span className="u-numeric u-text-faint">{item.order}</span>
            <span className={item.doneAt ? 'u-text-faint u-struck' : undefined}>
              {arabic ? item.titleAr : item.titleEn}
            </span>
            <span className="u-grow" />
            {item.doneAt ? (
              <span className="u-text-faint u-ltr u-numeric">{item.doneAt.slice(0, 10)}</span>
            ) : (
              <Button
                small
                tone="quiet"
                busy={step.isPending}
                onClick={() => step.mutate(item.order)}
              >
                {t('tasks.markDone')}
              </Button>
            )}
          </div>
        ))}
      </Card>

      <Card title={t('tasks.people')}>
        <div className="line">
          <span>{t('tasks.assigned')}</span>
          <span className="u-grow" />
          <span className="u-text-soft">
            {detail.assignees.length === 0
              ? t('tasks.unassigned')
              : detail.assignees
                  .map((person) => `${person.displayName} (${t(`assignmentRoles.${person.role}`)})`)
                  .join(t('listSeparator'))}
          </span>
        </div>
        <div className="line">
          <span>{t('tasks.timeRecorded')}</span>
          <span className="u-grow" />
          <strong className="u-ltr u-numeric">{duration(detail.recordedSeconds, t)}</strong>
        </div>
      </Card>
    </div>
  );
}
