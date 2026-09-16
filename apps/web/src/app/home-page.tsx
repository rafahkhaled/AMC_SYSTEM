import type { Caller } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Loading } from '../design/index.js';
import { recentAudit } from '../features/auth/api.js';

/**
 * A placeholder home, and openly so. It shows who you are and what the system
 * has recorded, which is enough to prove the path works end to end. The
 * dashboard proper is FR-80 and arrives with the data it is meant to summarise.
 */
export function HomePage({ caller }: { caller: Caller }) {
  const { t, i18n } = useTranslation();

  const canReadAudit = caller.permissions.includes('audit.read');
  const trail = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => recentAudit(8),
    enabled: canReadAudit,
  });

  // Dubai time, whatever the server or the laptop is set to.
  const time = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-AE' : 'en-AE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dubai',
  });

  return (
    <div className="u-stack">
      <div className="u-stack-tight">
        <h1>{t('home.welcome', { name: caller.displayName })}</h1>
        <p className="u-text-soft">
          {t('home.role')}:{' '}
          {caller.roles.map((role) => t(`roles.${role}`)).join(t('listSeparator'))}
        </p>
      </div>

      <Card title={t('home.permissions')} description={t('home.permissionsHint')}>
        <div className="u-row" style={{ gap: 'var(--space-2)' }}>
          {caller.permissions.map((permission) => (
            <Badge key={permission}>
              <span className="u-ltr u-mono">{permission}</span>
            </Badge>
          ))}
        </div>
      </Card>

      {canReadAudit ? (
        <Card title={t('home.recentActivity')} description={t('home.recentActivityHint')}>
          {trail.isLoading ? <Loading label={t('loading')} /> : null}
          {trail.data?.length === 0 ? <Empty title={t('home.noActivity')} /> : null}

          {trail.data && trail.data.length > 0 ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('home.when')}</th>
                    <th>{t('home.what')}</th>
                    <th>{t('home.who')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trail.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="u-ltr u-numeric u-text-faint">
                        {time.format(new Date(entry.occurredAt))}
                      </td>
                      <td>
                        <span className="u-ltr u-mono">{entry.action}</span>
                      </td>
                      <td className="u-text-soft">{entry.actorLabel ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
