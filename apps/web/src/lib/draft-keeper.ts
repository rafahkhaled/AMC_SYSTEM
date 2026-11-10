/**
 * What was typed into any form, kept until the server has it.
 *
 * The firm asked that a failed save never mean typing everything again, in
 * every part of the system. Doing that form by form would leave whichever form
 * was forgotten, so it is done once, here, for every form on every screen:
 *
 * - As somebody types, the boxes of the form (or card) they are in are written
 *   to this browser, under the page heading, the card's title and each box's
 *   label, which is what makes it the same form next time.
 * - When a form or card appears and a draft is kept for it, the boxes are
 *   filled back in and a short note says so.
 * - The draft is forgotten only when a save the person started succeeds: a
 *   change sent to the server (anything but a read) that comes back OK within
 *   a short while of them pressing a button in that form. A refusal keeps it.
 *
 * Never kept: passwords, files, search boxes, or anything marked
 * `data-no-draft`. Drafts are this browser's only, last a week, and are all
 * forgotten on signing out, so the next person at the desk does not see them.
 */

const PREFIX = 'amc.draft.auto.';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long after pressing a button a successful save still counts as that form's. */
const SAVE_WINDOW_MS = 60_000;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface Draft {
  readonly at: number;
  readonly values: Record<string, string>;
}

let installed = false;
let observer: MutationObserver | null = null;
let pressed: { key: string; at: number } | null = null;

export function installDraftKeeper(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  forgetOld();

  document.addEventListener('input', remember, true);
  document.addEventListener('change', remember, true);
  // A button pressed in a form or card: the save that follows is that form's.
  document.addEventListener(
    'click',
    (event) => {
      const button = (event.target as Element | null)?.closest?.('button');
      const box = button ? containerOf(button) : null;
      if (box) pressed = { key: keyOf(box), at: Date.now() };
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      const box = containerOf(event.target as Element);
      if (box) pressed = { key: keyOf(box), at: Date.now() };
    },
    true,
  );

  watchSaves();

  // Forms appear as screens open and cards unfold: fill each in once.
  observer = new MutationObserver(() => restoreAll());
  observer.observe(document.body, { childList: true, subtree: true });
  restoreAll();
}

/** Stops watching the page; for tests, whose page goes away under it. */
export function stopDraftKeeper(): void {
  observer?.disconnect();
  observer = null;
}

/** Signing out: nothing typed by this person stays for the next one. */
export function forgetAllDrafts(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('amc.draft.')) window.localStorage.removeItem(key);
    }
  } catch {
    // No storage, nothing to forget.
  }
}

/* ---------------------------------------------------------------- saving */

function remember(event: Event): void {
  const field = event.target as Field | null;
  if (!field || !eligible(field)) return;
  const box = containerOf(field);
  if (!box) return;
  const values: Record<string, string> = {};
  for (const [name, one] of fieldsOf(box)) values[name] = typedIn(one);
  write(keyOf(box), { at: Date.now(), values });
}

/**
 * Every change sent to the server goes through `fetch`; a successful one
 * shortly after a button in a form was pressed means that form was saved.
 */
function watchSaves(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (method !== 'GET' && response.ok && pressed && Date.now() - pressed.at < SAVE_WINDOW_MS) {
      remove(pressed.key);
      pressed = null;
    }
    return response;
  };
}

/* ------------------------------------------------------------- restoring */

function restoreAll(): void {
  for (const box of document.querySelectorAll<HTMLElement>('form, .card')) {
    // A card holding a form is the form's business, not the card's.
    if (box.matches('.card') && box.querySelector('form')) continue;
    if (box.dataset.draftChecked === 'yes') continue;
    box.dataset.draftChecked = 'yes';
    const draft = read(keyOf(box));
    if (!draft) continue;

    let changed = false;
    for (const [name, field] of fieldsOf(box)) {
      const saved = draft.values[name];
      if (saved === undefined || saved === typedIn(field)) continue;
      put(field, saved);
      changed = true;
    }
    if (changed) announce();
  }
}

/** Sets a box the way typing would, so the screen's own state hears about it. */
function put(field: Field, value: string): void {
  if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
    if (field.checked !== (value === 'true')) field.click();
    return;
  }
  const prototype = Object.getPrototypeOf(field) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/** A note in the corner, outside the screen's own markup, for a few seconds. */
function announce(): void {
  const arabic = (document.documentElement.lang || 'ar').startsWith('ar');
  const note = document.createElement('div');
  note.className = 'draft-note';
  note.setAttribute('role', 'status');
  note.textContent = arabic
    ? 'أُعيد ما كتبته ولم يُحفظ. راجعه ثم احفظ.'
    : 'What you typed and did not save is back. Check it, then save.';
  document.body.append(note);
  window.setTimeout(() => note.remove(), 7000);
}

/* ------------------------------------------------------------ the shapes */

function containerOf(element: Element): HTMLElement | null {
  return (element.closest('form') ?? element.closest('.card')) as HTMLElement | null;
}

/** The page's heading, the card's title, and which form of that card it is. */
function keyOf(box: HTMLElement): string {
  const heading = document.querySelector('main h1, h1')?.textContent?.trim() ?? '';
  const card = box.closest('.card') ?? box;
  const title = card.querySelector('h2, h3, legend')?.textContent?.trim() ?? '';
  const forms = Array.from(card.querySelectorAll('form'));
  const index = box.tagName === 'FORM' ? forms.indexOf(box as HTMLFormElement) : -1;
  return `${PREFIX}${heading}|${title}|${index}`;
}

/** The boxes worth keeping, each named by its label and how many came before with that label. */
function fieldsOf(box: HTMLElement): [string, Field][] {
  const seen = new Map<string, number>();
  const named: [string, Field][] = [];
  for (const field of box.querySelectorAll<Field>('input, textarea, select')) {
    if (!eligible(field)) continue;
    const label =
      field.labels?.[0]?.textContent?.trim() ||
      field.getAttribute('aria-label') ||
      field.getAttribute('name') ||
      field.getAttribute('placeholder') ||
      field.tagName;
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);
    named.push([`${label}#${count}`, field]);
  }
  return named;
}

function eligible(field: Element): field is Field {
  if (
    !(
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement
    )
  ) {
    return false;
  }
  if (field.closest('[data-no-draft]')) return false;
  if (field instanceof HTMLInputElement) {
    return !['password', 'file', 'hidden', 'search', 'submit', 'button'].includes(field.type);
  }
  return true;
}

function typedIn(field: Field): string {
  if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
    return String(field.checked);
  }
  return field.value;
}

/* --------------------------------------------------------------- storage */

function read(key: string): Draft | null {
  try {
    const text = window.localStorage.getItem(key);
    if (!text) return null;
    const draft = JSON.parse(text) as Draft;
    return Date.now() - draft.at > WEEK_MS ? null : draft;
  } catch {
    return null;
  }
}

function write(key: string, draft: Draft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // No room or no storage: the form works, only without the safety net.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}

function forgetOld(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX) && !read(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing to tidy.
  }
}
