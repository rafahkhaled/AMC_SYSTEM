import { useTranslation } from 'react-i18next';
import { type Language, applyLanguage } from '../i18n/index.js';

/** Switches the whole document, direction included, and remembers the choice. */
export function LanguageSwitch() {
  const { i18n, t } = useTranslation();

  const toggle = async () => {
    const next: Language = i18n.language === 'ar' ? 'en' : 'ar';
    await i18n.changeLanguage(next);
    applyLanguage(next);
  };

  return (
    <button
      type="button"
      className="quiet"
      onClick={toggle}
      lang={i18n.language === 'ar' ? 'en' : 'ar'}
    >
      {t('language')}
    </button>
  );
}
