import type { BoardProject, ProjectStateName } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { projectBoard } from './api.js';
import { WorkloadPanel } from './workload-panel.js';

/**
 * The board.
 *
 * Columns rather than a single list, because the question a manager asks is
 * "what is stuck and where", and that is a shape question. The server decides
 * which columns exist and in what order, so the screen cannot invent a state
 * the domain does not have.
 */
export function ProjectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'board' | 'people'>('board');

  return (
    <div className="u-stack">
      <div className="u-row tabs">
        {(['board', 'people'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={`tab${tab === which ? ' tab--active' : ''}`}
            aria-current={tab === which ? 'page' : undefined}
            onClick={() => setTab(which)}
          >
            {t(`projects.tabs.${which}`)}
          </button>
        ))}
      </div>

      {tab === 'board' ? <Board onOpen={onOpen} /> : <WorkloadPanel />}
    </div>
  );
}

function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const board = useQuery({ queryKey: ['projects'], queryFn: projectBoard });

  if (board.isLoading) return <Loading label={t('loading')} />;
  if (board.isError) return <p className="alert alert--error">{t('projects.failed')}</p>;

  const columns = board.data?.columns ?? [];
  const total = columns.reduce((count, column) => count + column.projects.length, 0);

  if (total === 0) {
    return (
      <Card title={t('nav.projects')}>
        <Empty title={t('projects.none')} description={t('projects.noneHint')} />
      </Card>
    );
  }

  return (
    <div className="board">
      {columns.map((column) => (
        <section key={column.state} className="board__column">
          <header className="board__heading">
            <h2>{t(`projectStates.${column.state}`)}</h2>
            <span className="u-text-faint u-numeric">{column.projects.length}</span>
          </header>
          {column.projects.length === 0 ? (
            <p className="board__quiet">{t('projects.columnEmpty')}</p>
          ) : (
            column.projects.map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project.id)} />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: BoardProject; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <button type="button" className="project-card" onClick={onOpen}>
      <strong className="project-card__client">{project.clientName}</strong>
      <span className="u-text-soft">{t(`services.${project.service}`)}</span>
      {project.periodKey ? <span className="u-text-faint u-ltr">{project.periodKey}</span> : null}

      <div className="project-card__marks">
        {project.dueAt ? (
          <span className={`u-ltr u-numeric ${project.isOverdue ? 'u-danger' : 'u-text-faint'}`}>
            {project.dueAt.slice(0, 10)}
          </span>
        ) : null}
        {project.missingDocuments.length > 0 ? (
          <Badge tone="warning">
            {t('clients.missingDocuments', { count: project.missingDocuments.length })}
          </Badge>
        ) : null}
        {project.recordedSeconds > 0 ? (
          <Badge>{t('projects.recorded', { hours: duration(project.recordedSeconds, t) })}</Badge>
        ) : null}
      </div>

      <span className="u-text-faint project-card__people">
        {project.assignees.length === 0
          ? t('projects.unassigned')
          : project.assignees.map((person) => person.displayName).join(t('listSeparator'))}
      </span>
    </button>
  );
}

export type { ProjectStateName };
