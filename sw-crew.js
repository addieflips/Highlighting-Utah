// Highlighting Utah — Crew Portal Service Worker
// Caches the app shell so the Crew Portal can open with no signal.
// Firestore's own offline persistence (enabled in employee.html) handles
// the actual checklist/route data — this worker only handles the page itself.

const CACHE_NAME = 'hu-crew-shell-v1';

const APP_SHELL = [
  '/employee.html',
  '/manifest-crew.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for the app shell only.
// Everything else (Firestore, Firebase Auth, Cloudinary, Google Maps,
// EmailJS, etc.) passes straight through to the network untouched —
// those need to be live, not cached.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  const isAppShellRequest =
    event.request.method === 'GET' &&
    url.origin === self.location.origin &&
    APP_SHELL.some((path) => url.pathname === path);

  if (!isAppShellRequest) {
    return; // let the browser handle it normally
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => cached); // offline: fall back to cached shell

      return cached || networkFetch;
    })
  );
});
