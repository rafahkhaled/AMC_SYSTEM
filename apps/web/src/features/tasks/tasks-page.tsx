import type { BoardTask, TaskStateName } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { taskBoard } from './api.js';

/**
 * The board.
 *
 * Columns rather than a single list, because the question a manager asks is
 * "what is stuck and where", and that is a shape question. The server decides
 * which columns exist and in what order, so the screen cannot invent a state
 * the domain does not have.
 */
export function TasksPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const board = useQuery({ queryKey: ['tasks'], queryFn: taskBoard });

  if (board.isLoading) return <Loading label={t('loading')} />;
  if (board.isError) return <p className="alert alert--error">{t('tasks.failed')}</p>;

  const columns = board.data?.columns ?? [];
  const total = columns.reduce((count, column) => count + column.tasks.length, 0);

  if (total === 0) {
    return (
      <Card title={t('nav.tasks')}>
        <Empty title={t('tasks.none')} description={t('tasks.noneHint')} />
      </Card>
    );
  }

  return (
    <div className="board">
      {columns.map((column) => (
        <section key={column.state} className="board__column">
          <header className="board__heading">
            <h2>{t(`taskStates.${column.state}`)}</h2>
            <span className="u-text-faint u-numeric">{column.tasks.length}</span>
          </header>
          {column.tasks.length === 0 ? (
            <p className="board__quiet">{t('tasks.columnEmpty')}</p>
          ) : (
            column.tasks.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={() => onOpen(task.id)} />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: BoardTask; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <button type="button" className="task-card" onClick={onOpen}>
      <strong className="task-card__client">{task.clientName}</strong>
      <span className="u-text-soft">{t(`services.${task.service}`)}</span>
      {task.periodKey ? <span className="u-text-faint u-ltr">{task.periodKey}</span> : null}

      <div className="task-card__marks">
        {task.dueAt ? (
          <span className={`u-ltr u-numeric ${task.isOverdue ? 'u-danger' : 'u-text-faint'}`}>
            {task.dueAt.slice(0, 10)}
          </span>
        ) : null}
        {task.missingDocuments.length > 0 ? (
          <Badge tone="warning">
            {t('clients.missingDocuments', { count: task.missingDocuments.length })}
          </Badge>
        ) : null}
        {task.recordedSeconds > 0 ? (
          <Badge>{t('tasks.recorded', { hours: duration(task.recordedSeconds, t) })}</Badge>
        ) : null}
      </div>

      <span className="u-text-faint task-card__people">
        {task.assignees.length === 0
          ? t('tasks.unassigned')
          : task.assignees.map((person) => person.displayName).join(t('listSeparator'))}
      </span>
    </button>
  );
}

export type { TaskStateName };
