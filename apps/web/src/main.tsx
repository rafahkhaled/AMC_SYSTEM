import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.js';
import { SessionProvider } from './features/auth/session.js';
import { setUpI18n } from './i18n/index.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 means sign in again, not try again. Retrying an authorisation
      // failure only delays the screen that would tell the person what to do.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof Error && error.message.includes('sign in')),
      staleTime: 30_000,
    },
  },
});

async function start(): Promise<void> {
  await setUpI18n();

  const container = document.getElementById('root');
  if (!container) throw new Error('The root element is missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

/*
 * Registered only in a built application. In development the worker would sit
 * between Vite and the page and serve a stale module after every edit, which
 * costs more time than it saves.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // An unregistered worker means no offline shell, not a broken
      // application. Nothing on screen should change because of it.
    });
  });
}

void start();
registerServiceWorker();
