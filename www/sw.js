// sw.js — ScriptSchedule Service Worker
// Handles BOTH PWA caching AND OneSignal push notifications.
//
// IMPORTANT: When deploying updates, BUMP THE CACHE_VERSION below.
// Otherwise users will see the old cached version of the app.

const CACHE_VERSION = "scriptschedule-v6";

// Import OneSignal SDK Worker — this gives us push notification handling
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// ── PWA CACHING ──────────────────────────────────────────────────────────────
// Basic offline-first caching for the app shell

self.addEventListener("install", (event) => {
  // Activate this new worker immediately on next page load
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up old caches when a new SW takes over
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Network-first strategy with cache fallback for HTML pages.
// (Static assets like icons can be served from cache directly.)
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests and cross-origin requests
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Skip Netlify functions (always go to network)
  if (url.pathname.startsWith("/.netlify/")) return;

  // For HTML: try network first, fall back to cache
  if (event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // Cache the fresh response
          const cloned = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, cloned));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For other resources: cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((resp) => {
        if (resp.ok) {
          const cloned = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, cloned));
        }
        return resp;
      });
    })
  );
});

// ── PUSH NOTIFICATION ACTION HANDLING ────────────────────────────────────────
// When a user clicks a notification button (Take/Snooze/Skip), we need to:
// 1. Open or focus the app
// 2. Pass the action info to the app so it can update state
//
// OneSignal handles the basic notification display. We add custom handling
// for the action buttons via notificationclick event.

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data?.custom?.a || notification.data || {};

  // Did they click an action button or the notification body?
  const actionId = event.action; // "take", "snooze", or "" if main body

  // Build a URL to focus/open with action info as query params
  const baseUrl = "https://scriptschedule.app/";
  let targetUrl = baseUrl;
  if (actionId && data.medId) {
    targetUrl = `${baseUrl}?action=${actionId}&med=${encodeURIComponent(data.medId)}&t=${encodeURIComponent(data.doseTime || "")}`;
  } else if (data.medId) {
    targetUrl = `${baseUrl}?med=${encodeURIComponent(data.medId)}`;
  }

  notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If a ScriptSchedule window is already open, focus it and send a message
      for (const client of windowClients) {
        if (client.url.startsWith(baseUrl) && "focus" in client) {
          client.postMessage({
            type: "notification_action",
            action: actionId || "open",
            medId: data.medId,
            doseTime: data.doseTime
          });
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
