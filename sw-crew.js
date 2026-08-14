// Highlighting Utah — Crew Portal Service Worker
// Caches the app shell so the Crew Portal can open with no signal.
// Firestore's own offline persistence (enabled in employee.html) handles
// the actual checklist/route data — this worker only handles the page itself.

// Bump this version string on any change here. Changing it is what clears
// out the old cache on everyone's phones.
const CACHE_NAME = 'hu-crew-shell-v4';

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

/* ⚠ THE APP ITSELF IS CROSS-ORIGIN, AND WITHOUT THIS THE OFFLINE STORY DID
   NOT SURVIVE A RELOAD.
   employee.html is a cached page whose entire code lives in three ES modules
   loaded from www.gstatic.com. The fetch handler below deliberately ignores
   every cross-origin request, so on a reload with no signal the crew got the
   cached page and then nothing at all: a shell that could not boot. Firestore's
   own offline persistence was working perfectly underneath an app that never
   started.

   These three URLs are safe to cache hard because they are VERSION-PINNED
   (10.12.2). They only change when someone edits that version in
   employee.html, and CACHE_NAME must be bumped in the same commit when they
   do — which is the same rule that already applies to everything else here. */
const VENDOR_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

const APP_SHELL = PAGE_PATHS.concat(STATIC_PATHS);

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* Same-origin shell must succeed — if it cannot, the install should
         fail loudly rather than leave a half-cached worker in place. The
         vendor modules are added separately and allowed to fail: gstatic
         being unreachable at install time must not stop the page itself
         being cached, and they will be picked up on the next fetch. */
      return cache.addAll(APP_SHELL).then(function () {
        return Promise.all(VENDOR_URLS.map(function (u) {
          return cache.add(new Request(u, { mode: 'cors' })).catch(function () {});
        }));
      });
    })
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

  if (event.request.method !== 'GET') {
    return;
  }

  /* The three version-pinned Firebase modules are the ONLY cross-origin
     requests this worker touches. Cache-first, then network: they never change
     for a given version, and without them a cached employee.html is a page
     with no app in it. Everything else cross-origin — Firestore's own traffic,
     Google Maps, Cloudinary — still passes straight through untouched, which
     is what the origin check below is protecting. */
  if (VENDOR_URLS.indexOf(url.href) !== -1) {
    event.respondWith(
      caches.match(event.request).then(function (hit) {
        if (hit) return hit;
        return fetch(event.request).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(event.request, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) {
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
