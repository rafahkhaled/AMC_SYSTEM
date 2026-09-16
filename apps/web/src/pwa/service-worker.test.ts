import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The service worker is plain JavaScript served as a file, so it is not part
 * of the TypeScript build and nothing else would ever look at it. It is also
 * the one piece of the application that can answer a request without asking
 * the server, which makes what it refuses to cache worth proving rather than
 * commenting.
 */
const SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../public/service-worker.js'),
  'utf8',
);

const ORIGIN = 'https://amc.example';

type Listener = (event: FetchEventLike) => void;

interface FetchEventLike {
  request: RequestLike;
  respondWith: (value: unknown) => void;
}

interface RequestLike {
  url: string;
  method: string;
  mode?: string;
  clone?: () => RequestLike;
}

function load() {
  const listeners = new Map<string, Listener>();
  const store = new Map<string, unknown>();

  const cache = {
    addAll: vi.fn(async () => undefined),
    put: vi.fn(async (key: RequestLike | string, value: unknown) => {
      store.set(typeof key === 'string' ? key : key.url, value);
    }),
    keys: vi.fn(async () => [...store.keys()]),
  };

  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ['amc-shell-v1']),
    delete: vi.fn(async () => true),
    match: vi.fn(async (key: RequestLike | string) =>
      store.get(typeof key === 'string' ? key : key.url),
    ),
  };

  const fetchMock = vi.fn(async () => response('from the network'));

  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };

  // The worker reads these as globals; a worker scope has no window to hang
  // them on, so they are supplied the same way the runtime would.
  new Function('self', 'caches', 'fetch', 'Response', 'URL', SOURCE)(
    self,
    caches,
    fetchMock,
    FakeResponse,
    URL,
  );

  return { listeners, caches, cache, fetchMock, store };
}

class FakeResponse {
  constructor(
    readonly body: string,
    readonly ok = true,
  ) {}
  clone() {
    return new FakeResponse(this.body, this.ok);
  }
  static error() {
    return new FakeResponse('error', false);
  }
}

function response(body: string, ok = true) {
  return new FakeResponse(body, ok);
}

function fire(
  listeners: Map<string, Listener>,
  request: RequestLike,
): { answered: boolean; value: Promise<unknown> | undefined } {
  let value: Promise<unknown> | undefined;
  let answered = false;
  listeners.get('fetch')?.({
    request,
    respondWith: (given) => {
      answered = true;
      value = Promise.resolve(given);
    },
  });
  return { answered, value };
}

function get(path: string, over: Partial<RequestLike> = {}): RequestLike {
  const url = path.startsWith('http') ? path : `${ORIGIN}${path}`;
  return { url, method: 'GET', mode: 'no-cors', clone: () => get(path, over), ...over };
}

describe('the offline shell', () => {
  let worker: ReturnType<typeof load>;

  beforeEach(() => {
    vi.clearAllMocks();
    worker = load();
  });

  it('never answers a request to the API', async () => {
    // The cache is keyed by URL and shared by everyone using the device, so a
    // cached /api reply would outlive the session that was allowed to see it.
    for (const path of [
      '/api/clients',
      '/api/timer',
      '/api/auth/me',
      '/api/clients/abc/documents',
    ]) {
      expect(fire(worker.listeners, get(path)).answered, path).toBe(false);
    }
    expect(worker.caches.match).not.toHaveBeenCalled();
    expect(worker.cache.put).not.toHaveBeenCalled();

    // The control. Without this the test above would pass just as well on a
    // worker that handled nothing at all.
    expect(fire(worker.listeners, get('/icon-192.png')).answered).toBe(true);
  });

  it('leaves anything that is not a plain GET alone', () => {
    expect(fire(worker.listeners, get('/', { method: 'POST' })).answered).toBe(false);
    expect(fire(worker.listeners, get('https://elsewhere.example/thing.js')).answered).toBe(false);
  });

  it('opens from the cache when the network has gone', async () => {
    worker.store.set('/', response('the shell'));
    worker.fetchMock.mockRejectedValueOnce(new Error('offline'));

    const { answered, value } = fire(worker.listeners, get('/timer', { mode: 'navigate' }));

    expect(answered).toBe(true);
    expect(await value).toMatchObject({ body: 'the shell' });
  });

  it('prefers the network for a navigation, so a new version takes effect', async () => {
    worker.store.set('/', response('the old shell'));

    const { value } = fire(worker.listeners, get('/', { mode: 'navigate' }));

    expect(await value).toMatchObject({ body: 'from the network' });
  });

  it('keeps the build assets and nothing else', async () => {
    await fire(worker.listeners, get('/assets/index-abc123.js')).value;
    await fire(worker.listeners, get('/some-other-file.json')).value;

    const kept = worker.cache.put.mock.calls.map(([key]) =>
      typeof key === 'string' ? key : (key as RequestLike).url,
    );
    expect(kept).toEqual([`${ORIGIN}/assets/index-abc123.js`]);
  });

  it('caches the shell on install and drops older versions on activate', async () => {
    const waits: Promise<unknown>[] = [];
    const event = { waitUntil: (p: Promise<unknown>) => waits.push(p) };

    (worker.listeners.get('install') as unknown as (e: typeof event) => void)(event);
    (worker.listeners.get('activate') as unknown as (e: typeof event) => void)(event);
    await Promise.all(waits);

    expect(worker.cache.addAll).toHaveBeenCalledWith(
      expect.arrayContaining(['/', '/manifest.webmanifest']),
    );
    // 'amc-shell-v1' is the current one, so nothing should have been deleted.
    expect(worker.caches.delete).not.toHaveBeenCalled();
  });
});
