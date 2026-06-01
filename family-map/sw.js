// family-map — Service Worker
// Phase 1 (2026-06-01): receive server push + display notification + tap-to-open.
// Phase 3 will add: Cloudflare Worker cron that calls the Web Push API to send
// scheduled-event reminders server-side (the SW here only needs to *receive* them).
// SW-VERSION: 2026-06-02.4 (push-received broadcast diagnostic)
'use strict';

/* Take control immediately on install so we don't have to wait for a page reload */
self.addEventListener('install', () => self.skipWaiting());

/* Claim all open clients on activate (existing open tabs also get this SW) */
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

/* ─── Incoming server push → display notification ──────────────────────────── */
self.addEventListener('push', event => {
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
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { appUrl, eventId } = event.notification.data || {};
  const target = appUrl || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
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
        // (deep-link via eventId added in Phase 3 if needed)
        return clients.openWindow(target);
      })
  );
});
