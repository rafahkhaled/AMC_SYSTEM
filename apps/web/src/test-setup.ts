import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// Forms keep what was typed in this browser until it is saved (lib/use-draft),
// and one test's unsaved form must not open itself in the next.
beforeEach(() => {
  window.localStorage.clear();
});
