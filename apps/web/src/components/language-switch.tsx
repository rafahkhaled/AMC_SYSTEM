import { useTranslation } from 'react-i18next';
import { Button } from '../design/index.js';
import { type Language, applyLanguage } from '../i18n/index.js';

/** Switches the whole document, direction included, and remembers the choice. */
export function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const next: Language = i18n.language === 'ar' ? 'en' : 'ar';

  const toggle = async () => {
    await i18n.changeLanguage(next);
    applyLanguage(next);
  };

  return (
    <Button tone="secondary" small onClick={toggle} lang={next}>
      {t('language')}
    </Button>
  );
}
