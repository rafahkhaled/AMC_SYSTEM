import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { type Language, translations } from './translations.js';

const STORAGE_KEY = 'amc.language';

export function storedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'en' ? 'en' : 'ar';
  } catch {
    // Private browsing can refuse storage entirely. Arabic is the default.
    return 'ar';
  }
}

/**
 * Direction belongs to the document, not to a component, because the browser
 * uses it for text selection, scrollbars and form controls that no stylesheet
 * reaches.
 */
export function applyLanguage(language: Language): void {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* a refused write must not break the switch itself */
  }
}

export async function setUpI18n(): Promise<typeof i18next> {
  const language = storedLanguage();
  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'ar',
    resources: {
      ar: { translation: translations.ar },
      en: { translation: translations.en },
    },
    interpolation: { escapeValue: false },
  });
  applyLanguage(language);
  return i18next;
}

export { translations };
export type { Language };
