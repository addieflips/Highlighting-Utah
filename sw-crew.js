// Highlighting Utah — Crew Portal Service Worker
// Caches the app shell so the Crew Portal can open with no signal.
// Firestore's own offline persistence (enabled in employee.html) handles
// the actual checklist/route data — this worker only handles the page itself.

// Bump this version string on any change here. Changing it is what clears
// out the old cache on everyone's phones.
const CACHE_NAME = 'hu-crew-shell-v3';

// The page itself. Always fetched fresh when there's signal, so a deploy
// shows up on the very next open instead of the one after.
const PAGE_PATHS = [
  '/employee.html'
];

// Supporting files that almost never change. Cache-first is fine for these.
const STATIC_PATHS = [
  '/manifest-crew.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

const APP_SHELL = PAGE_PATHS.concat(STATIC_PATHS);

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

// Fetch strategy depends on what's being asked for.
// Everything not listed in APP_SHELL (Firestore, Firebase Auth, Cloudinary,
// Google Maps, EmailJS, etc.) passes straight through to the network untouched.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  const isPage = PAGE_PATHS.some((path) => url.pathname === path);
  const isStatic = STATIC_PATHS.some((path) => url.pathname === path);
  // Only the crew portal's own page gets the network-first treatment.
  // Matching every navigation here made this worker intercept admin.html
  // and the public site too, with employee.html as the offline fallback —
  // wrong page entirely. Scope it to our own paths.
  const isNavigation = event.request.mode === 'navigate' && isPage;

  if (!isPage && !isStatic && !isNavigation) {
    return; // let the browser handle it normally
  }

  if (isPage || isNavigation) {
    // NETWORK-FIRST: fresh page when online, cached page when not.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached || caches.match('/employee.html')
          )
        )
    );
    return;
  }

  // CACHE-FIRST for icons and the manifest — these rarely change, and the
  // version bump above is what refreshes them.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
      );
    })
  );
});
