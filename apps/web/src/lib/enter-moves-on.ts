/**
 * Enter takes you to the next box, everywhere.
 *
 * The firm types a client's details from a paper or a message, box after box,
 * and asked not to have to reach for the mouse between them. In a browser
 * Enter either does nothing or sends the whole form half-filled; here it moves
 * on to the next box in the same form (or card), the way a spreadsheet does.
 *
 * - In the last box of a form, Enter does what it always did: saves.
 * - In a text area, Enter is a new line, as it should be.
 * - On a button, a checkbox or a search box, Enter is left alone.
 * - Shift+Enter, or anything marked `data-enter-submits`, keeps the browser's way.
 */

let installed = false;

const SKIPPED_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'search', 'file']);

export function installEnterMovesOn(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', onKeyDown);
}

/** For tests, whose page goes away under it. */
export function stopEnterMovesOn(): void {
  document.removeEventListener('keydown', onKeyDown);
  installed = false;
}

export function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.defaultPrevented) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  // Typing Arabic or Chinese, Enter may be choosing a word, not leaving the box.
  if (event.isComposing) return;

  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  if (field instanceof HTMLInputElement && SKIPPED_TYPES.has(field.type)) return;
  if (field.closest('[data-enter-submits]')) return;

  const box = field.closest('form') ?? field.closest('.card');
  if (!box) return;
  const fields = Array.from(box.querySelectorAll<HTMLElement>('input, select, textarea')).filter(
    usable,
  );
  const next = fields[fields.indexOf(field) + 1];
  // The last box: let the form be sent, as Enter always did.
  if (!next) return;

  event.preventDefault();
  next.focus();
  if (next instanceof HTMLInputElement && typeof next.select === 'function') {
    try {
      next.select();
    } catch {
      // Some kinds of box (a date) have nothing to select.
    }
  }
}

/** A box someone could type in now: shown, enabled, not a button. */
function usable(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'hidden' || SKIPPED_TYPES.has(element.type)) return false;
  }
  if ((element as HTMLInputElement).disabled || (element as HTMLInputElement).readOnly) {
    return false;
  }
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  // Hidden by a class such as u-visually-hidden, or inside a closed section.
  if (element.classList.contains('u-visually-hidden')) return false;
  return element.getClientRects().length > 0 || isTestPage();
}

/** jsdom lays nothing out, so every box there has no size; count them all. */
function isTestPage(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}
