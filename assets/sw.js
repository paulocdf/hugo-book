const cacheName = self.location.pathname
const pages = [
{{ if eq .Site.Params.BookServiceWorker "precache" }}
  {{ range .Site.AllPages -}}
  "{{ .RelPermalink }}",
  {{ end -}}
{{ end }}
];

// ── Notification scheduling ──
// Stores pending notification timers: tag -> timeoutId
const pendingNotifications = {};

self.addEventListener("install", function (event) {
  self.skipWaiting();

  caches.open(cacheName).then((cache) => {
    return cache.addAll(pages);
  });
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

// Handle messages from the main thread for notification scheduling
self.addEventListener("message", function (event) {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === "schedule-notification") {
    // Cancel any existing notification with the same tag
    if (pendingNotifications[data.tag]) {
      clearTimeout(pendingNotifications[data.tag]);
      delete pendingNotifications[data.tag];
    }

    const delay = Math.max(0, data.delay || 0);

    pendingNotifications[data.tag] = setTimeout(function () {
      delete pendingNotifications[data.tag];
      self.registration.showNotification(data.title || "Timer", {
        body: data.body || "",
        tag: data.tag || "pomodoro",
        icon: data.icon || "",
        badge: data.icon || "",
        requireInteraction: false,
        silent: false,
      });
    }, delay);
  }

  if (data.type === "cancel-notification") {
    if (pendingNotifications[data.tag]) {
      clearTimeout(pendingNotifications[data.tag]);
      delete pendingNotifications[data.tag];
    }
  }

  if (data.type === "cancel-all-notifications") {
    Object.keys(pendingNotifications).forEach(function (tag) {
      clearTimeout(pendingNotifications[tag]);
      delete pendingNotifications[tag];
    });
  }
});

// When user taps a notification, focus the app window
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      // Focus existing window if available
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].visibilityState === "visible" || clients[i].url) {
          return clients[i].focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow("./");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  /**
   * @param {Response} response
   * @returns {Promise<Response>}
   */
  function saveToCache(response) {
    if (cacheable(response)) {
      return caches
        .open(cacheName)
        .then((cache) => cache.put(request, response.clone()))
        .then(() => response);
    } else {
      return response;
    }
  }

  /**
   * @param {Error} error
   */
  function serveFromCache(error) {
    return caches.open(cacheName).then((cache) => cache.match(request.url));
  }

  /**
   * @param {Response} response
   * @returns {Boolean}
   */
  function cacheable(response) {
    return response.type === "basic" && response.ok && !response.headers.has("Content-Disposition")
  }

  event.respondWith(fetch(request).then(saveToCache).catch(serveFromCache));
});
