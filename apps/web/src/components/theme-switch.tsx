import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../design/index.js';
import { type ThemePreference, applyTheme, storedTheme, watchDevice } from '../design/theme.js';

const CHOICES: ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Light, dark, or whatever the device says.
 *
 * A select rather than a toggle, because there are three states and a toggle
 * can only hold two — and the third, "follow my device", is the one most
 * people want and the one a two-way switch quietly takes away.
 */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const [preference, setPreference] = useState<ThemePreference>(storedTheme);

  // While the choice is `system`, a laptop switching at sunset should carry
  // the interface with it rather than wait for a reload.
  useEffect(() => {
    if (preference !== 'system') return;
    return watchDevice(() => applyTheme('system'));
  }, [preference]);

  return (
    <Field
      label={t('theme.label')}
      control={(props) => (
        <select
          {...props}
          className="input"
          value={preference}
          onChange={(event) => {
            const chosen = event.target.value as ThemePreference;
            setPreference(chosen);
            applyTheme(chosen);
          }}
        >
          {CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {t(`theme.${choice}`)}
            </option>
          ))}
        </select>
      )}
    />
  );
}
