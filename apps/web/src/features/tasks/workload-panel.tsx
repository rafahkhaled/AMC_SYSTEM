import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { workload } from './api.js';

/**
 * Who is on what (FR-13).
 *
 * The server answers with nothing for anyone who cannot assign work, so this
 * shows nothing to them rather than a list they could not act on.
 *
 * Open work and recorded hours sit side by side on purpose. Either alone
 * misleads: eight open tasks is not a problem for somebody who has been at
 * them all week, and two is, for somebody who has recorded nothing.
 */
export function WorkloadPanel() {
  const { t } = useTranslation();
  const people = useQuery({ queryKey: ['workload'], queryFn: workload });

  if (people.isLoading) return <Loading label={t('loading')} />;
  if (people.isError) return <p className="alert alert--error">{t('tasks.failed')}</p>;

  const data = people.data;
  if (!data || data.people.length === 0) {
    return (
      <Card title={t('workload.title')}>
        <Empty title={t('workload.nothing')} description={t('workload.nothingHint')} />
      </Card>
    );
  }

  return (
    <Card title={t('workload.title')} description={t('workload.hint')}>
      {data.unassignedTasks > 0 ? (
        <p className="alert alert--warning">
          {t('workload.unassigned', { count: data.unassignedTasks })}
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t('workload.person')}</th>
              <th>{t('workload.open')}</th>
              <th>{t('workload.late')}</th>
              <th>{t('workload.thisWeek')}</th>
              <th>{t('workload.recorded')}</th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((person) => (
              <tr key={person.userId}>
                <td>
                  {person.displayName}
                  <span className="u-text-faint u-block">
                    {t(`roles.${person.role}`, { defaultValue: person.role })}
                  </span>
                </td>
                <td className="u-numeric">{person.openTasks}</td>
                <td className="u-numeric">
                  {person.overdueTasks > 0 ? (
                    <Badge tone="danger">{person.overdueTasks}</Badge>
                  ) : (
                    <span className="u-text-faint">—</span>
                  )}
                </td>
                <td className="u-numeric">{person.dueThisWeek}</td>
                <td className="u-ltr u-numeric">
                  {person.recordedSeconds === 0 ? (
                    <span className="u-text-faint">—</span>
                  ) : (
                    duration(person.recordedSeconds, t)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
