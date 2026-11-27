/* global self, clients */
// A reload can read the list before pagehide sends its keepalive removals.
// Keep only in-flight work and an in-memory invalidation flag for returning pages.
const removals = new Set();
let hadRemovals = false;
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method === "POST" && /^\/(en|es)\/lists\/[^/]+\/items\/[^/]+\/remove$/.test(url.pathname)) {
    hadRemovals = true;
    const request = fetch(event.request);
    removals.add(request);
    event.respondWith(request);
    event.waitUntil(request.catch(() => {}).finally(() => removals.delete(request)));
  }
});

self.addEventListener("message", (event) => {
  if (event.data !== "settle-list-removals") return;
  event.waitUntil(Promise.allSettled([...removals]).then(() => {
    event.ports[0]?.postMessage(hadRemovals);
  }));
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json();
  if (!payload || typeof payload.title !== "string" || typeof payload.body !== "string" ||
    typeof payload.tag !== "string" || !/^\/(en|es)\/notifications$/.test(payload.url)) return;

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/gift-192.png",
    tag: payload.tag,
    data: {url: payload.url},
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  if (!/^\/(en|es)\/notifications$/.test(path)) return;

  event.waitUntil((async () => {
    const url = new URL(path, self.location.origin).href;
    const windows = await clients.matchAll({type: "window"});
    const existing = windows.find((window) => window.url === url);
    if (existing) await existing.focus();
    else await clients.openWindow(url);
  })());
});
