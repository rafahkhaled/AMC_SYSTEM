const STORAGE_KEY = 'amc.theme';

/**
 * What somebody chose, which is not the same as what they see.
 *
 * `system` is a choice too — "keep following this device" — and it is the
 * default, because an accountant working late should get a dark screen
 * without going to look for a setting.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export function storedTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    // Private browsing can refuse storage entirely.
    return 'system';
  }
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** What the screen actually shows, once `system` has been resolved. */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'system' ? (prefersDark() ? 'dark' : 'light') : preference;
}

/**
 * Puts the choice on the document and remembers it.
 *
 * The attribute carries the resolved value rather than the preference,
 * because the stylesheet needs to know what to paint and does not care why.
 */
export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* a refused write must not break the switch itself */
  }
}

/**
 * Follows the device while `system` is the choice.
 *
 * Somebody whose laptop switches at sunset should see the interface switch
 * with it, without reloading. Returns the unsubscribe, and does nothing at
 * all once a person has chosen for themselves.
 */
export function watchDevice(onChange: () => void): () => void {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) return () => undefined;

  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
