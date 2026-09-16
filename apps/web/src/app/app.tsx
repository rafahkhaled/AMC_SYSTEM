import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../features/auth/session.js';
import { SignInPage } from '../features/auth/sign-in-page.js';
import { TwoFactorPage } from '../features/auth/two-factor-page.js';
import { ClientPage } from '../features/clients/client-page.js';
import { ClientsPage } from '../features/clients/clients-page.js';
import { AppShell } from './app-shell.js';
import { HomePage } from './home-page.js';

/**
 * Which screen to show is decided by what the server says about the session,
 * not by a route. There is no URL that reaches the application while signed
 * out, so there is no gap between a router deciding and a guard refusing.
 *
 * Navigation within the application is still state rather than URLs. Real
 * routing arrives when a screen is worth linking to directly, which none of
 * these are yet.
 */
type View = { name: 'home' } | { name: 'clients' } | { name: 'client'; id: string };

export function App() {
  const { state } = useSession();
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ name: 'clients' });

  switch (state.status) {
    case 'loading':
      return (
        <main className="u-centre">
          <p className="u-text-soft">{t('loading')}</p>
        </main>
      );
    case 'needs-code':
      return <TwoFactorPage />;
    case 'signed-in':
      return (
        <AppShell
          caller={state.caller}
          active={view.name === 'client' ? 'clients' : view.name}
          onNavigate={(name) => setView({ name } as View)}
        >
          {view.name === 'home' ? <HomePage caller={state.caller} /> : null}
          {view.name === 'clients' ? (
            <ClientsPage onOpen={(id) => setView({ name: 'client', id })} />
          ) : null}
          {view.name === 'client' ? (
            <ClientPage id={view.id} onBack={() => setView({ name: 'clients' })} />
          ) : null}
        </AppShell>
      );
    default:
      return <SignInPage />;
  }
}
