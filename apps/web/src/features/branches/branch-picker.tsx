import { useTranslation } from 'react-i18next';
import { Field, Select } from '../../design/index.js';
import { useBranches } from './use-branches.js';

/**
 * Which branch a document goes out under (feedback item 12b).
 *
 * Renders nothing for a firm that has set no branches up: there is nothing to
 * choose between, and a dropdown with one empty option is a question with no
 * answer. Retired branches are not offered — except the one already chosen,
 * which stays so an old document does not appear to have lost its branch.
 */
export function BranchPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const branches = useBranches();
  const arabic = i18n.language === 'ar';

  const offered = branches.all.filter((branch) => !branch.retired || branch.code === value);
  if (offered.length === 0) return null;

  return (
    <Field
      label={t('branches.pick')}
      hint={t('branches.pickHint')}
      control={(props) => (
        <Select
          {...props}
          disabled={disabled}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('branches.choose')}</option>
          {offered.map((branch) => (
            <option key={branch.code} value={branch.code}>
              {arabic ? branch.nameAr || branch.nameEn : branch.nameEn || branch.nameAr}
            </option>
          ))}
        </Select>
      )}
    />
  );
}
