import type { ProjectDetail, ProjectStateName } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Card,
  DateInput,
  Field,
  Loading,
  Select,
} from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { ClassificationPanel } from '../classification/classification-panel.js';
import { staffDirectory } from '../staff/api.js';
import { StartTimerButton } from '../timer/timer-page.js';
import {
  assignProject,
  attachDocument,
  completeTask,
  deleteProject,
  moveProject,
  openNextProject,
  projectDetail,
  resumeRepeating,
  setTaskDue,
  stopRepeating,
  unassignProject,
} from './api.js';

/** One piece of work: where it has got to, what it is waiting on, what is next. */
export function ProjectPage({
  id,
  onBack,
  onOpen,
  canAssign = false,
}: {
  id: string;
  /** Whether this person may put people on the job, or delete it. */
  canAssign?: boolean;
  onBack: () => void;
  /** Go to another piece of work, such as the one just opened. */
  onOpen?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const project = useQuery({ queryKey: ['project', id], queryFn: () => projectDetail(id) });

  const settle = (next: ProjectDetail) => {
    queries.setQueryData(['project', id], next);
    // The board's columns and counts are wrong the moment this changes.
    void queries.invalidateQueries({ queryKey: ['projects'] });
  };

  // Which backward move is being explained, if any.
  const [goingBack, setGoingBack] = useState<ProjectStateName | null>(null);
  const [reason, setReason] = useState('');

  const move = useMutation({
    mutationFn: ({ to, reason: why }: { to: ProjectStateName; reason?: string }) =>
      moveProject(id, to, why),
    onSuccess: settle,
  });
  const due = useMutation({
    mutationFn: ({ order, dueOn }: { order: number; dueOn: string | null }) =>
      setTaskDue(id, order, dueOn),
    onSuccess: settle,
  });
  const task = useMutation({
    mutationFn: (order: number) => completeTask(id, order),
    onSuccess: settle,
  });
  /*
   * What to do about the next one, once a recurring job is finished (item 9).
   * Opening goes to the new project; stopping and resuming change this one's
   * page in place.
   */
  const next = useMutation({
    mutationFn: () => openNextProject(id),
    onSuccess: (opened) => {
      void queries.invalidateQueries({ queryKey: ['projects'] });
      queries.setQueryData(['project', opened.id], opened);
      onOpen?.(opened.id);
    },
  });
  const repeat = useMutation({
    mutationFn: (stop: boolean) => (stop ? stopRepeating(id) : resumeRepeating(id)),
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
  const refusal = move.error ?? task.error ?? attach.error ?? next.error ?? repeat.error;
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
          {detail.timersRunning.length > 0 ? (
            <Badge tone="success">
              {t('jobs.timerRunningBy', {
                names: detail.timersRunning
                  .map((timer) => timer.displayName)
                  .join(t('listSeparator')),
              })}
            </Badge>
          ) : null}
          {detail.isOverdue ? <Badge tone="danger">{t('projects.overdue')}</Badge> : null}
        </div>
      </header>

      {refusal ? <Alert tone="error">{refusal.message}</Alert> : null}

      {/*
        Only once a recurring job is finished. The sweep opens work for the
        period that has just closed on its own; what it cannot know is whether
        this client should carry straight on with the next, or whether this
        was a one-off — and that is a decision for the person finishing it.
      */}
      {detail.continuation ? (
        <Card title={t('projects.continue.title')} description={t('projects.continue.hint')}>
          {detail.continuation.repeating ? (
            <div className="u-row u-wrap">
              <Button busy={next.isPending} onClick={() => next.mutate()}>
                {t('projects.continue.openNext')}
              </Button>
              <Button tone="secondary" busy={repeat.isPending} onClick={() => repeat.mutate(true)}>
                {t('projects.continue.oneTime')}
              </Button>
            </div>
          ) : (
            <div className="u-stack-tight">
              <p className="u-text-soft">{t('projects.continue.stopped')}</p>
              <div className="u-row u-wrap">
                <Button
                  tone="secondary"
                  busy={repeat.isPending}
                  onClick={() => repeat.mutate(false)}
                >
                  {t('projects.continue.resume')}
                </Button>
                <Button tone="quiet" busy={next.isPending} onClick={() => next.mutate()}>
                  {t('projects.continue.openNext')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      <Card
        title={t('projects.whatNext')}
        description={
          detail.state === 'completed' || detail.state === 'cancelled'
            ? t('projects.reopenHint')
            : t('projects.whatNextHint')
        }
      >
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
                  onClick={() => {
                    // A step back is explained before it happens, not
                    // refused afterwards by a server the person cannot see.
                    if (detail.backwardTransitions.includes(state)) {
                      setGoingBack(state);
                      setReason('');
                    } else {
                      move.mutate({ to: state });
                    }
                  }}
                >
                  {t(`projectStates.${state}`)}
                </Button>
              );
            })
          )}
          <span className="u-grow" />
          {detail.state === 'in_progress' ? <StartTimerButton projectId={detail.id} /> : null}
        </div>

        {goingBack ? (
          <form
            className="u-stack-tight"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim().length >= 3) {
                move.mutate({ to: goingBack, reason: reason.trim() });
                setGoingBack(null);
              }
            }}
          >
            <Field
              label={t('projects.goingBack', {
                state: t(`projectStates.${goingBack}`),
              })}
              hint={t('projects.goingBackHint')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="u-row">
              <Button type="submit" small busy={move.isPending} disabled={reason.trim().length < 3}>
                {t('projects.goBack')}
              </Button>
              <Button small tone="quiet" onClick={() => setGoingBack(null)}>
                {t('projects.cancelGoBack')}
              </Button>
            </div>
          </form>
        ) : null}
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

            {/*
             * A date for the step, not only for the work.
             * Typed straight in and saved on change: it moves whenever the
             * client moves it, and a save button would make that a chore.
             */}
            {item.doneAt ? null : (
              <DateInput
                className="input input--inline"
                aria-label={t('projects.stepDue', { step: item.order })}
                value={item.dueOn ?? ''}
                disabled={due.isPending}
                onChange={(event) =>
                  due.mutate({ order: item.order, dueOn: event.target.value || null })
                }
              />
            )}

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

      <ClassificationPanel entity="project" id={id} canEdit />

      <Card title={t('projects.people')}>
        <div className="line">
          <span>{t('projects.assigned')}</span>
          <span className="u-grow" />
          {detail.assignees.length === 0 ? (
            <span className="u-text-soft">{t('projects.unassigned')}</span>
          ) : null}
        </div>
        {detail.assignees.map((person) => (
          <div className="line" key={person.userId}>
            <span className="u-typed">{person.displayName}</span>
            <span className="u-text-faint">{t(`assignmentRoles.${person.role}`)}</span>
            <span className="u-grow" />
            {canAssign ? (
              <Button
                small
                tone="quiet"
                onClick={() =>
                  void unassignProject(id, person.userId).then(() => project.refetch())
                }
              >
                {t('projects.unassign')}
              </Button>
            ) : null}
          </div>
        ))}
        {canAssign ? <AssignPerson projectId={id} onDone={() => void project.refetch()} /> : null}
        <div className="line">
          <span>{t('projects.timeRecorded')}</span>
          <span className="u-grow" />
          <strong className="u-ltr u-numeric">{duration(detail.recordedSeconds, t)}</strong>
        </div>
        <p className="u-text-faint">{t('projects.timeHow')}</p>
      </Card>

      {canAssign ? <DeleteProject projectId={id} onDeleted={onBack} /> : null}
    </div>
  );
}

/** Choosing who is responsible for the job, or who helps on it. */
function AssignPerson({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const staff = useQuery({ queryKey: ['staff'], queryFn: staffDirectory });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'responsible' | 'collaborator'>('responsible');
  const assign = useMutation({
    mutationFn: () => assignProject(projectId, userId, role),
    onSuccess: () => {
      setUserId('');
      onDone();
    },
  });
  const people = (staff.data ?? []).filter(
    (person) => person.status === 'active' && !person.roles.includes('client'),
  );

  return (
    <div className="u-stack-tight">
      <div className="u-row u-row-top">
        <Field
          label={t('projects.assignWho')}
          control={(props) => (
            <Select {...props} value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">{t('projects.assignChoose')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </Select>
          )}
        />
        <Field
          label={t('projects.assignAs')}
          control={(props) => (
            <Select
              {...props}
              value={role}
              onChange={(event) => setRole(event.target.value as 'responsible' | 'collaborator')}
            >
              <option value="responsible">{t('assignmentRoles.responsible')}</option>
              <option value="collaborator">{t('assignmentRoles.collaborator')}</option>
            </Select>
          )}
        />
      </div>
      {assign.isError ? <Alert tone="error">{(assign.error as Error).message}</Alert> : null}
      <div className="u-row">
        <Button
          small
          disabled={userId === ''}
          busy={assign.isPending}
          onClick={() => assign.mutate()}
        >
          {t('projects.assign')}
        </Button>
      </div>
    </div>
  );
}

/** Deleting a job nobody worked on; the server refuses one with time or billing. */
function DeleteProject({ projectId, onDeleted }: { projectId: string; onDeleted: () => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['projects'] });
      void queries.invalidateQueries({ queryKey: ['clients'] });
      onDeleted();
    },
  });

  return (
    <Card title={t('projects.deleteTitle')} description={t('projects.deleteHint')}>
      {remove.isError ? <Alert tone="error">{(remove.error as Error).message}</Alert> : null}
      <div className="u-row">
        {asking ? (
          <>
            <Button tone="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              {t('projects.deleteConfirm')}
            </Button>
            <Button tone="quiet" onClick={() => setAsking(false)}>
              {t('clients.cancel')}
            </Button>
          </>
        ) : (
          <Button tone="secondary" onClick={() => setAsking(true)}>
            {t('projects.delete')}
          </Button>
        )}
      </div>
    </Card>
  );
}
