/**
 * Timer actions that have not reached the server yet (NFR-03).
 *
 * The rule this exists for: a person taps stop, the train goes into a tunnel,
 * and the hour they worked is not lost. The action is written down before the
 * network is attempted, so the record survives the request failing, the tab
 * closing, and the laptop shutting.
 *
 * IndexedDB rather than localStorage because the queue must survive a tab
 * being killed mid-write, and because localStorage is synchronous and this
 * runs while a person is tapping a button.
 *
 * What is stored is the *intent* and the instant it was formed. The server
 * clamps that instant to the window it knows the timer was running, so a
 * queue sitting on a phone overnight can only ever shorten what it reports.
 */

export type TimerAction = 'start' | 'stop' | 'hold' | 'resume';

export interface QueuedAction {
  /** Monotonic within this browser, which is what keeps replay in order. */
  readonly id: number;
  readonly action: TimerAction;
  readonly taskId: string | null;
  /** When the person did it, not when it was sent. */
  readonly at: string;
}

const DATABASE = 'amc-timer';
const STORE = 'pending';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('The timer queue refused'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** Writes the action down. Called before the network, never after. */
export async function enqueue(action: TimerAction, taskId: string | null, at = new Date()) {
  await run('readwrite', (store) =>
    store.add({ action, taskId, at: at.toISOString() } as Omit<QueuedAction, 'id'>),
  );
}

export async function pending(): Promise<QueuedAction[]> {
  const all = await run<QueuedAction[]>('readonly', (store) => store.getAll());
  // Insertion order is the order things happened, and the order they must be
  // replayed in: a start after a stop is a different day's work.
  return all.sort((a, b) => a.id - b.id);
}

export async function forget(id: number): Promise<void> {
  await run('readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

export async function clear(): Promise<void> {
  await run('readwrite', (store) => store.clear() as unknown as IDBRequest<undefined>);
}

/**
 * Whether this browser can queue at all.
 *
 * Private windows and locked-down profiles refuse IndexedDB. Where it is
 * refused the application still works; it simply cannot promise that a tap
 * made in a tunnel survives. Silently pretending otherwise would be worse.
 */
export function available(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}
