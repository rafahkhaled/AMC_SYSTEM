import { useEffect, useRef, useState } from 'react';

/**
 * What somebody has typed into a form, kept until it is saved.
 *
 * The firm asked for this after a save failed and everything had to be typed
 * again. The values are written to this browser as they change, brought back
 * the next time the same form is opened (on the same record), and forgotten
 * once the save goes through. Kept in this browser only: never a password,
 * which the caller leaves out of `values`.
 *
 * Storage can be unavailable (a private window, a full disk); the form then
 * works exactly as before, only without the safety net.
 */
export function useDraft<T extends object>(
  key: string,
  values: T,
  restore: (saved: Partial<T>) => void,
): { restored: boolean; discard: () => void } {
  const storageKey = `amc.draft.${key}`;
  const [restored, setRestored] = useState(false);
  const started = useRef(false);
  const serialised = JSON.stringify(values);

  // Once, on opening: bring back what was left unsaved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening only
  useEffect(() => {
    const saved = read(storageKey);
    if (saved) {
      restore(saved as Partial<T>);
      setRestored(true);
    }
  }, [storageKey]);

  useEffect(() => {
    // Not on the first render: that is the record as it is, not a change.
    if (!started.current) {
      started.current = true;
      return;
    }
    write(storageKey, serialised);
  }, [storageKey, serialised]);

  return {
    restored,
    discard: () => {
      remove(storageKey);
      setRestored(false);
    },
  };
}

function read(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function write(key: string, text: string): void {
  try {
    window.localStorage.setItem(key, text);
  } catch {
    // No room or no storage: the form still works, only without the draft.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}
