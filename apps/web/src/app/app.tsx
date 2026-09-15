import { useTranslation } from 'react-i18next';
import { useSession } from '../features/auth/session.js';
import { SignInPage } from '../features/auth/sign-in-page.js';
import { TwoFactorPage } from '../features/auth/two-factor-page.js';
import { HomePage } from './home-page.js';

/**
 * Which screen to show is decided by what the server says about the session,
 * not by a route. There is no URL that reaches the application while signed
 * out, so there is no gap between the router deciding and the guard refusing.
 * Real routing arrives with the screens that need it, in P1.
 */
export function App() {
  const { state } = useSession();
  const { t } = useTranslation();

  switch (state.status) {
    case 'loading':
      return (
        <main className="centred">
          <p className="muted">{t('loading')}</p>
        </main>
      );
    case 'needs-code':
      return <TwoFactorPage />;
    case 'signed-in':
      return <HomePage caller={state.caller} />;
    default:
      return <SignInPage />;
  }
}
