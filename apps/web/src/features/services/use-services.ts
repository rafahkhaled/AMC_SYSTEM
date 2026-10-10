import type { ServiceView } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import i18next from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { listServices } from './api.js';

/** The key every screen already reads a service's name through. */
const keyFor = (code: string) => `services.${code}`;

/**
 * Teaches the translation bundle the names of the services the firm added.
 *
 * Nine screens print a project's service as `t('services.<code>')`, and the
 * eleven built-ins are in the bundle. A service added from Settings today is
 * not, and it cannot be: it has no deploy behind it. Rather than changing nine
 * screens to ask somewhere else, the names are put where they already look.
 *
 * Built-ins are left alone so the translation files stay the single source for
 * them.
 */
export function registerServiceNames(services: readonly ServiceView[]): boolean {
  let added = false;
  for (const service of services) {
    if (service.builtIn) continue;
    for (const [language, name] of [
      ['en', service.nameEn],
      ['ar', service.nameAr],
    ] as const) {
      if (i18next.getResource(language, 'translation', keyFor(service.code)) === name) continue;
      i18next.addResource(language, 'translation', keyFor(service.code), name, { silent: true });
      added = true;
    }
  }
  return added;
}

/**
 * The firm's services, and a way to name any code at all.
 *
 * `live` is what a picker offers; `all` includes retired ones, because a
 * project opened under a service that has since been retired still has to
 * show what it was.
 */
export function useServices(): {
  live: ServiceView[];
  all: ServiceView[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: ['services'],
    queryFn: listServices,
    // Changes when an administrator edits it, which is rarely.
    staleTime: 5 * 60_000,
  });
  const all = query.data ?? [];

  return { live: all.filter((service) => !service.retired), all, loading: query.isLoading };
}

/**
 * Mounted once, for a signed-in user, so every screen can name every service.
 *
 * Re-announces the language after registering names. Without it the screens
 * that already rendered would keep showing `services.custom_x` until something
 * else made them draw again.
 */
export function useRegisterServiceNames(): void {
  const { all } = useServices();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (all.length > 0 && registerServiceNames(all)) {
      void i18n.changeLanguage(i18n.language);
    }
  }, [all, i18n]);
}
