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

void start();
