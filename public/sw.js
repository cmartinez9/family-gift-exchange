/* global self, clients */
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
