import { useEffect, useState } from 'react';

/**
 * Showing a document, and printing it.
 *
 * "Print" used to only show the document on the screen, and people waited for
 * a print dialog that never came. Now it shows the document and then opens the
 * browser's print dialog once the document is on the page, so what prints is
 * the sheet and not a blank. `ready` is false until what the sheet needs (the
 * firm's letterhead) has arrived.
 */
export function usePrint(ready: boolean): {
  shown: boolean;
  toggle: () => void;
  print: () => void;
} {
  const [shown, setShown] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending || !shown || !ready) return;
    // After this render, so the sheet is in the page when the dialog opens.
    const timer = window.setTimeout(() => {
      setPending(false);
      window.print();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [pending, shown, ready]);

  return {
    shown,
    toggle: () => setShown((now) => !now),
    print: () => {
      setShown(true);
      setPending(true);
    },
  };
}
