/*
 * The service worker exists so the application opens on a phone with no signal
 * and so it can be installed to a home screen. It caches the shell — the
 * markup, the script, the stylesheet, the icons — and nothing else.
 *
 * It must never cache anything under /api. Two reasons, and the second is the
 * serious one:
 *
 *   1. A cached reply would show yesterday's deadlines as though they were
 *      today's, which for a tax practice is worse than showing nothing.
 *   2. The cache is keyed by URL and shared by everyone who uses the device.
 *      A cached /api/clients would survive signing out and be served to the
 *      next person to sign in. Access scoping is decided on the server for
 *      every request, and a cache is a way to answer without asking.
 *
 * Offline recording of time is a separate matter with its own queue. It is not
 * this file's job, and a cache is the wrong tool for it.
 */

const VERSION = 'amc-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // see the note above

  /*
   * Navigations are answered from the network when there is one, because a
   * deployed version should take effect on the next visit rather than the
   * one after. The cached shell is the fallback, which is what makes the
   * installed application open at all when the signal has gone.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only the build's own immutable assets are worth keeping.
        if (response.ok && url.pathname.startsWith('/assets/')) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
