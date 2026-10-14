const SHELL_CACHE = "sampo-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Сампо";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      lang: "ru",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || undefined,
      data: payload.data || {},
      actions: Array.isArray(payload.actions) ? payload.actions : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action === "accept" || event.action === "decline" ? event.action : "";
  if (action && data.requestId) {
    event.waitUntil(actOnRequest(data.requestId, action).catch(() => openUrl(data.url || `/requests/${data.requestId}`)));
    return;
  }
  event.waitUntil(openUrl(data.url || "/calendar"));
});

async function actOnRequest(requestId, action) {
  const refreshed = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
  if (!refreshed.ok) {
    await openUrl(`/requests/${requestId}`);
    return;
  }
  const session = await refreshed.json().catch(() => null);
  if (!session?.accessToken) {
    await openUrl(`/requests/${requestId}`);
    return;
  }
  const response = await fetch(`/api/requests/${requestId}/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) await openUrl(`/requests/${requestId}`);
}

async function openUrl(path) {
  const url = new URL(path || "/calendar", self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    if (!("navigate" in client)) continue;
    try {
      await client.focus();
      await client.navigate(url);
      return;
    } catch {
      // Это окно не открылось, попробуем новое.
    }
  }
  await self.clients.openWindow(url);
}
