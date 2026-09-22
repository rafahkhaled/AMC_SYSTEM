import type { ProjectDetail, ProjectStateName } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { StartTimerButton } from '../timer/timer-page.js';
import { attachDocument, completeTask, moveProject, projectDetail } from './api.js';

/** One piece of work: where it has got to, what it is waiting on, what is next. */
export function ProjectPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const project = useQuery({ queryKey: ['project', id], queryFn: () => projectDetail(id) });

  const settle = (next: ProjectDetail) => {
    queries.setQueryData(['project', id], next);
    // The board's columns and counts are wrong the moment this changes.
    void queries.invalidateQueries({ queryKey: ['projects'] });
  };

  const move = useMutation({
    mutationFn: (to: ProjectStateName) => moveProject(id, to),
    onSuccess: settle,
  });
  const task = useMutation({
    mutationFn: (order: number) => completeTask(id, order),
    onSuccess: settle,
  });
  const attach = useMutation({
    mutationFn: ({ type, documentId }: { type: string; documentId: string }) =>
      attachDocument(id, type, documentId),
    onSuccess: settle,
  });

  if (project.isLoading) return <Loading label={t('loading')} />;
  if (project.isError || !project.data)
    return <p className="alert alert--error">{t('projects.failed')}</p>;

  const detail = project.data;
  const refusal = move.error ?? task.error ?? attach.error;
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
          <Badge>{t(`projectStates.${detail.state}`)}</Badge>
          {detail.isOverdue ? <Badge tone="danger">{t('projects.overdue')}</Badge> : null}
        </div>
      </header>

      {refusal ? <Alert tone="error">{refusal.message}</Alert> : null}

      <Card title={t('projects.whatNext')} description={t('projects.whatNextHint')}>
        <div className="u-row u-wrap">
          {detail.allowedTransitions.length === 0 ? (
            <p className="u-text-faint">{t('projects.closed')}</p>
          ) : (
            detail.allowedTransitions.map((state) => {
              /*
               * The lifecycle says a ready project may start; the document gate
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
                      ? t('projects.blockedBy', {
                          documents: detail.missingDocuments
                            .map((type) => t(`documentTypes.${type}`))
                            .join(t('listSeparator')),
                        })
                      : undefined
                  }
                  onClick={() => move.mutate(state)}
                >
                  {t(`projectStates.${state}`)}
                </Button>
              );
            })
          )}
          <span className="u-grow" />
          {detail.state === 'in_progress' ? <StartTimerButton projectId={detail.id} /> : null}
        </div>
      </Card>

      <Card title={t('projects.documents')} description={t('projects.documentsHint')}>
        {detail.requirements.length === 0 ? (
          <p className="u-text-faint">{t('projects.noDocumentsNeeded')}</p>
        ) : (
          detail.requirements.map((requirement) => {
            const candidates = detail.availableDocuments.filter(
              (document) => document.type === requirement.type,
            );
            return (
              <div key={requirement.type} className="line">
                <span>{t(`documentTypes.${requirement.type}`)}</span>
                {requirement.mandatory ? <Badge>{t('projects.mandatory')}</Badge> : null}
                <span className="u-grow" />
                {requirement.documentId ? (
                  <>
                    <Badge tone="success">{t('projects.attached')}</Badge>
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
                    {t('projects.attachHeld')}
                  </Button>
                ) : (
                  <Badge tone="warning">{t('projects.notHeld')}</Badge>
                )}
              </div>
            );
          })
        )}
      </Card>

      <Card title={t('projects.tasks')} description={t('projects.tasksHint')}>
        {detail.tasks.map((item) => (
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
                busy={task.isPending}
                onClick={() => task.mutate(item.order)}
              >
                {t('projects.markDone')}
              </Button>
            )}
          </div>
        ))}
      </Card>

      <Card title={t('projects.people')}>
        <div className="line">
          <span>{t('projects.assigned')}</span>
          <span className="u-grow" />
          <span className="u-text-soft">
            {detail.assignees.length === 0
              ? t('projects.unassigned')
              : detail.assignees
                  .map((person) => `${person.displayName} (${t(`assignmentRoles.${person.role}`)})`)
                  .join(t('listSeparator'))}
          </span>
        </div>
        <div className="line">
          <span>{t('projects.timeRecorded')}</span>
          <span className="u-grow" />
          <strong className="u-ltr u-numeric">{duration(detail.recordedSeconds, t)}</strong>
        </div>
      </Card>
    </div>
  );
}
