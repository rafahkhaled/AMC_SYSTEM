import type { Caller } from '@amc/contracts';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../components/language-switch.js';
import { Button } from '../design/index.js';
import { useSession } from '../features/auth/session.js';

type NavView = 'clients' | 'tasks' | 'calendar' | 'timer' | 'home';

const VIEWS = ['clients', 'tasks', 'calendar', 'timer', 'home'] as const;

/**
 * The frame every signed-in screen sits in.
 *
 * The navigation is a column down the side. Which side is never stated: the
 * layout is a grid with the menu first, so in Arabic the whole thing mirrors
 * and the menu lands on the right without a single direction rule.
 *
 * On a phone the column becomes a drawer. A fixed sidebar on a 375px screen
 * leaves too little for the work, and the work is the point.
 */
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
  const [open, setOpen] = useState(false);
  const menuId = useId();

  /*
   * Escape closes it, because a drawer that covers the screen and can only be
   * dismissed by finding the right patch of background is a trap for anyone
   * not using a mouse.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`shell${open ? ' shell--open' : ''}`}>
      {/* The phone bar. Hidden once there is room for the column itself. */}
      <header className="shell__bar">
        <button
          type="button"
          className="shell__toggle"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">☰</span>
          <span className="u-visually-hidden">{t('nav.menu')}</span>
        </button>
        <strong>{t('appName')}</strong>
      </header>

      {/*
        A real button, not a div with a click handler. Tapping beside the
        drawer is how most people close one, and doing that with a div leaves
        anyone on a keyboard with no way out but Escape — which they have to
        guess at. Labelled, so a screen reader says what it does.
      */}
      {open ? (
        <button type="button" className="shell__scrim" onClick={() => setOpen(false)}>
          <span className="u-visually-hidden">{t('nav.closeMenu')}</span>
        </button>
      ) : null}

      <nav id={menuId} className="shell__menu" aria-label={t('nav.menu')}>
        <strong className="shell__brand">{t('appName')}</strong>

        <ul className="shell__list">
          {VIEWS.map((view) => (
            <li key={view}>
              <button
                type="button"
                className={`nav__item${active === view ? ' nav__item--active' : ''}`}
                aria-current={active === view ? 'page' : undefined}
                onClick={() => {
                  onNavigate(view);
                  setOpen(false);
                }}
              >
                {t(`nav.${view}`)}
              </button>
            </li>
          ))}
        </ul>

        <div className="shell__foot">
          <span className="u-text-faint shell__who">{caller.displayName}</span>
          <LanguageSwitch />
          <Button tone="quiet" small block onClick={() => void signOut()}>
            {t('home.signOut')}
          </Button>
        </div>
      </nav>

      <main className="shell__main">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
