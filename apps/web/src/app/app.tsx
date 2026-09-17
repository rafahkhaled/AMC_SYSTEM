import type { Caller } from '@amc/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../features/auth/session.js';
import { SignInPage } from '../features/auth/sign-in-page.js';
import { TwoFactorPage } from '../features/auth/two-factor-page.js';
import { CalendarPage } from '../features/calendar/calendar-page.js';
import { ClientPage } from '../features/clients/client-page.js';
import { ClientsPage } from '../features/clients/clients-page.js';
import { InboxPage } from '../features/inbox/inbox-page.js';
import { TaskPage } from '../features/tasks/task-page.js';
import { TasksPage } from '../features/tasks/tasks-page.js';
import { TimerPage } from '../features/timer/timer-page.js';
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
type View =
  | { name: 'home' }
  | { name: 'clients' }
  | { name: 'tasks' }
  | { name: 'task'; id: string }
  | { name: 'calendar' }
  | { name: 'timer' }
  | { name: 'inbox' }
  | { name: 'client'; id: string };

/**
 * Which nav item is lit.
 *
 * A detail screen belongs to the section it was opened from, so the nav does
 * not go blank the moment somebody looks at one thing in detail.
 */
function activeNav(view: View): 'clients' | 'tasks' | 'calendar' | 'timer' | 'inbox' | 'home' {
  if (view.name === 'client') return 'clients';
  if (view.name === 'task') return 'tasks';
  return view.name;
}

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
          active={activeNav(view)}
          onNavigate={(name) => setView({ name } as View)}
        >
          <Screen view={view} caller={state.caller} go={setView} />
        </AppShell>
      );
    default:
      return <SignInPage />;
  }
}

/**
 * One screen, chosen by name.
 *
 * Pulled out of `App` because that function was doing two things: deciding
 * whether anybody is signed in, and deciding what they are looking at. Every
 * new screen made the second half longer without making the first any clearer.
 */
function Screen({
  view,
  caller,
  go,
}: {
  view: View;
  caller: Caller;
  go: (view: View) => void;
}) {
  switch (view.name) {
    case 'home':
      return <HomePage caller={caller} />;
    case 'clients':
      return <ClientsPage onOpen={(id) => go({ name: 'client', id })} />;
    case 'client':
      return <ClientPage id={view.id} onBack={() => go({ name: 'clients' })} />;
    case 'tasks':
      return <TasksPage onOpen={(id) => go({ name: 'task', id })} />;
    case 'task':
      return <TaskPage id={view.id} onBack={() => go({ name: 'tasks' })} />;
    case 'calendar':
      return <CalendarPage onOpenTask={(id) => go({ name: 'task', id })} />;
    case 'timer':
      return <TimerPage />;
    case 'inbox':
      return <InboxPage />;
  }
}
