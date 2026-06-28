// family-map — Service Worker
// Push (2026-06-01) + offline app-shell cache (2026-06-28).
// SW-VERSION: 2026-06-28.1  (adds offline caching of index.html + Firebase SDK)
'use strict';

/* ─── Offline app shell ─────────────────────────────────────────────────────
   Without this, the PWA could not even open offline (the HTML + Firebase SDK
   are fetched from the network each launch → iOS shows "not connected").
   Strategy:
     - page navigations: network-first (so deploys update), cached index offline
     - app files + Firebase SDK (gstatic, pinned version): stale-while-revalidate
     - Firestore / Maps / Cloudflare / push: passthrough (Firestore has its own
       IndexedDB offline cache; Maps just fails offline; the schedule still works)
   NOTE: the device must open the app ONCE while online so this SW installs and
   fills the cache; offline launches work from then on. */
const SHELL_CACHE = 'family-map-shell-2026-06-28.1';
const SCOPE     = self.registration.scope;                 // .../family-map/
const INDEX_URL = new URL('./index.html', SCOPE).href;
const ROOT_URL  = new URL('./', SCOPE).href;
const PRECACHE = [
  INDEX_URL,
  ROOT_URL,
  new URL('./manifest.json', SCOPE).href,
  new URL('../icon.png', SCOPE).href,
  new URL('../icon-192.png', SCOPE).href,
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      // Resilient: a single failed add (e.g. installed while flaky) must not
      // abort precaching the rest.
      await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})));
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('family-map-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
      );
    } catch (_) {}
    await self.clients.claim();
  })());
});

function isCacheableStatic(url) {
  if (url.origin === self.location.origin) {
    return /\.(html|json|png|svg|ico|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  }
  // Firebase SDK ESM modules (version-pinned → safe to cache forever).
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // 1) Page navigations → network-first, fall back to the cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        try { const c = await caches.open(SHELL_CACHE); await c.put(INDEX_URL, fresh.clone()); } catch (_) {}
        return fresh;
      } catch (_) {
        const c = await caches.open(SHELL_CACHE);
        const cached = (await c.match(INDEX_URL)) || (await c.match(ROOT_URL));
        return cached || new Response(
          'オフライン: アプリのキャッシュがまだありません。一度オンラインで開いてください。',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 2) App files + Firebase SDK → stale-while-revalidate (offline-capable).
  if (isCacheableStatic(url)) {
    event.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE);
      const cached = await c.match(req);
      const net = fetch(req)
        .then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {}); return res; })
        .catch(() => null);
      return cached || (await net) || new Response('', { status: 504 });
    })());
    return;
  }

  // 3) Everything else (Firestore, Maps tiles, Cloudflare workers, …): passthrough.
});

/* ─── Incoming server push → display notification ──────────────────────────── */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}

  const title   = d.title || 'FAMILY MAP';
  // Resolve the icon URL relative to the SW scope (scope = .../family-map/)
  // so the icon is at the parent level: .../icon-192.png
  const iconUrl = new URL('../icon-192.png', self.registration.scope).href;

  const options = {
    body:               d.body  || '',
    icon:               iconUrl,
    badge:              iconUrl,
    // Store appUrl + eventId in notification.data for the notificationclick handler
    data: {
      appUrl:  self.registration.scope,
      eventId: d.eventId || null,
    },
    // Tag deduplication: one notification per event, unlimited for generic pushes
    tag:                d.eventId ? `event-${d.eventId}` : `fm-${Date.now()}`,
    requireInteraction: false,
    renotify:           false,
  };
  event.waitUntil((async () => {
    // DIAGNOSTIC: tell any open app window that a push actually arrived at the
    // SW. The page shows a toast on PUSH_RECEIVED — proving delivery reached the
    // device independent of whether iOS renders the system notification banner.
    try {
      const cs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of cs) c.postMessage({ type: 'PUSH_RECEIVED', title, body: options.body });
    } catch (_) {}
    await self.registration.showNotification(title, options);
  })());
});

/* ─── Notification tap → focus or open the app window ──────────────────────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { appUrl, eventId } = event.notification.data || {};
  const target = appUrl || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        // Try to find an already-open family-map window
        for (const c of list) {
          if (c.url.startsWith(target) && 'focus' in c) {
            c.focus();
            // Tell the app to open the tapped event (if known)
            if (eventId) c.postMessage({ type: 'OPEN_EVENT', eventId });
            return;
          }
        }
        // No existing window — open the app fresh
        return clients.openWindow(target);
      })
  );
});
