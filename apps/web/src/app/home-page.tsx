import type { Caller } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../components/language-switch.js';
import { recentAudit } from '../features/auth/api.js';
import { useSession } from '../features/auth/session.js';

/**
 * A placeholder home, and openly so. It exists to prove the whole path works
 * in a browser: the session survives a refresh, the permissions are the ones
 * the server granted, and the audit trail is real. The dashboard proper is
 * FR-80 and arrives with the data it is meant to summarise.
 */
export function HomePage({ caller }: { caller: Caller }) {
  const { t, i18n } = useTranslation();
  const { signOut } = useSession();

  const canReadAudit = caller.permissions.includes('audit.read');
  const trail = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => recentAudit(8),
    enabled: canReadAudit,
  });

  const times = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-AE' : 'en-AE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Dubai',
  });

  return (
    <main className="page">
      <header className="row spread">
        <div className="stack-tight">
          <h1>{t('home.welcome', { name: caller.displayName })}</h1>
          <p className="muted">
            {t('home.role')}: {caller.roles.map((role) => t(`roles.${role}`)).join('، ')}
          </p>
        </div>
        <div className="row">
          <LanguageSwitch />
          <button type="button" className="quiet" onClick={() => void signOut()}>
            {t('home.signOut')}
          </button>
        </div>
      </header>

      <section className="panel stack">
        <h2>{t('home.permissions')}</h2>
        <div className="chips">
          {caller.permissions.map((permission) => (
            <span className="chip" key={permission}>
              {permission}
            </span>
          ))}
        </div>
      </section>

      {canReadAudit ? (
        <section className="panel stack">
          <h2>{t('home.recentActivity')}</h2>
          {trail.isLoading ? <p className="muted">{t('loading')}</p> : null}
          {trail.data && trail.data.length === 0 ? (
            <p className="muted">{t('home.noActivity')}</p>
          ) : null}
          <div className="trail">
            {trail.data?.map((entry) => (
              <div className="trail-row" key={entry.id}>
                <span className="trail-time">{times.format(new Date(entry.occurredAt))}</span>
                <span className="trail-action">{entry.action}</span>
                <span className="faint">{entry.actorLabel ?? '—'}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
