import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { setUpI18n } from './i18n/index.js';

/**
 * Renders a screen the way the application does.
 *
 * Every feature test needs the same two things: a query client that does not
 * retry, and a provider around the component. Written out in each file it was
 * six chances to configure one of them differently, and retries in particular
 * turn a test that asserts a refusal into one that waits for three attempts.
 *
 * Nothing is returned. Tests reach the rendered output through `screen`, which
 * is the same thing every existing test does.
 */
export function renderScreen(element: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  render(element, { wrapper: Wrapper });
}

/**
 * Puts the interface into one language before a test renders anything.
 *
 * Arabic is the default, so a test that reads English strings has to say so.
 * Call it in `beforeEach` rather than once per file: `setUpI18n` reads what is
 * stored at the moment it runs.
 */
export async function useLanguage(language: 'en' | 'ar' = 'en'): Promise<void> {
  localStorage.setItem('amc.language', language);
  await setUpI18n();
}
