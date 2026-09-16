import type { Caller } from '@amc/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../components/language-switch.js';
import { Button } from '../design/index.js';
import { useSession } from '../features/auth/session.js';

type NavView = 'clients' | 'timer' | 'home';

/** The frame every signed-in screen sits in. */
export function AppShell({
  caller,
  active,
  onNavigate,
  children,
}: {
  caller: Caller;
  active: NavView;
  onNavigate: (view: NavView) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { signOut } = useSession();

  return (
    <>
      <header className="app-bar">
        <div className="u-row u-spread app-bar__inner">
          <div className="u-row">
            <strong>{t('appName')}</strong>
            <nav className="u-row nav">
              {(['clients', 'timer', 'home'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  className={`nav__item${active === view ? ' nav__item--active' : ''}`}
                  aria-current={active === view ? 'page' : undefined}
                  onClick={() => onNavigate(view)}
                >
                  {t(`nav.${view}`)}
                </button>
              ))}
            </nav>
          </div>
          <div className="u-row">
            <span className="u-text-faint">{caller.displayName}</span>
            <LanguageSwitch />
            <Button tone="quiet" small onClick={() => void signOut()}>
              {t('home.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
