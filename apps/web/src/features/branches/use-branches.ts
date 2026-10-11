import type { BranchView } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listBranches } from './api.js';

/**
 * The firm's branches, in the reader's language.
 *
 * `live` is what a picker offers; `label` names any code at all, retired ones
 * included, because an invoice issued under a branch since closed still has to
 * say which it was.
 */
export function useBranches(): {
  live: BranchView[];
  all: BranchView[];
  loading: boolean;
  label: (code: string | null) => string | null;
} {
  const { i18n } = useTranslation();
  const query = useQuery({
    queryKey: ['branches'],
    queryFn: listBranches,
    // Changes when an administrator edits it, which is rarely.
    staleTime: 5 * 60_000,
  });
  const all = query.data ?? [];
  const arabic = i18n.language === 'ar';

  return {
    live: all.filter((branch) => !branch.retired),
    all,
    loading: query.isLoading,
    label: (code) => {
      if (code === null) return null;
      const found = all.find((branch) => branch.code === code);
      if (!found) return code;
      return arabic ? found.nameAr || found.nameEn : found.nameEn || found.nameAr;
    },
  };
}
