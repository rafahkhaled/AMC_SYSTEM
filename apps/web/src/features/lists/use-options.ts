import type { ReferenceList, ReferenceOption } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { referenceOptions } from './api.js';

/**
 * One list, in the reader's language.
 *
 * `live` is what a dropdown offers; `label` resolves any code at all,
 * retired ones included — a document filed three years ago has to keep
 * displaying as what it is after somebody stops offering that type.
 */
export function useOptions(list: ReferenceList): {
  live: ReferenceOption[];
  label: (code: string) => string;
  loading: boolean;
} {
  const { i18n } = useTranslation();
  const query = useQuery({
    queryKey: ['lists', list],
    queryFn: () => referenceOptions(list),
    // Reference data changes when an administrator edits it, which is rarely.
    staleTime: 5 * 60_000,
  });

  const options = query.data ?? [];
  const arabic = i18n.language === 'ar';
  const name = (option: ReferenceOption) =>
    arabic ? option.nameAr || option.nameEn : option.nameEn || option.nameAr;

  return {
    live: options.filter((option) => !option.retired),
    label: (code) => {
      const found = options.find((option) => option.code === code);
      // The raw code rather than nothing: an unreadable label is a bug to
      // chase, a blank cell is one nobody notices.
      return found ? name(found) : code;
    },
    loading: query.isLoading,
  };
}
