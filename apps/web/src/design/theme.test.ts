import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, resolveTheme, storedTheme, watchDevice } from './theme.js';

/** A device that says dark, or light, and can change its mind. */
function device(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    switchTo(nowDark: boolean) {
      query.matches = nowDark;
      for (const listener of listeners) listener();
    },
    get listening() {
      return listeners.size;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('choosing how the interface looks', () => {
  it('follows the device until somebody says otherwise', () => {
    device(true);
    expect(storedTheme()).toBe('system');
    expect(resolveTheme('system')).toBe('dark');

    device(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('lets a person override a device that is wrong for the room', () => {
    device(true);

    // The case a media query alone cannot express: light, on a laptop set to
    // dark. It is why the palette hangs off an attribute.
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(storedTheme()).toBe('light');
  });

  it('remembers the choice across a reload', () => {
    device(false);
    applyTheme('dark');
    expect(storedTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('writes what to paint, not why', () => {
    device(true);
    applyTheme('system');
    // The stylesheet needs a colour, not a preference.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storedTheme()).toBe('system');
  });

  it('follows a device that changes its mind while the app is open', () => {
    const laptop = device(false);
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');

    const stop = watchDevice(() => applyTheme('system'));
    laptop.switchTo(true);

    // Sunset, and the interface goes with it rather than waiting for a reload.
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
    expect(laptop.listening).toBe(0);
  });

  it('falls back to following the device when storage refuses', () => {
    device(true);
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('storage is unavailable');
    };
    expect(storedTheme()).toBe('system');
    Storage.prototype.getItem = original;
  });

  it('still switches when a refused write would otherwise throw', () => {
    device(false);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('storage is unavailable');
    };
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    Storage.prototype.setItem = original;
  });
});
