// Service worker of the admin PWA: shows Web Push notifications and opens their view when tapped.
// No fetch handler: the dashboard always loads from the network.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
    let data = {}
    try {
        data = event.data ? event.data.json() : {}
    } catch {}
    event.waitUntil(
        self.registration.showNotification(data.title || "RAGPulse", {
            body: data.body || "",
            tag: data.tag,
            // A replaced notification (same tag) alerts again
            renotify: !!data.tag,
            icon: "/icon-192.png",
            badge: "/badge-96.png",
            requireInteraction: !!data.priority,
            vibrate: data.priority ? [200, 100, 200, 100, 200] : [100],
            data: {url: data.url || "/admin"}
        })
    )
})

self.addEventListener("notificationclick", (event) => {
    event.notification.close()
    const url = new URL(event.notification.data?.url || "/admin", self.location.origin)
    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true})
            const dashboard = windows.find((c) => new URL(c.url).pathname.startsWith("/admin"))
            if (dashboard) {
                await dashboard.focus()
                // The open dashboard navigates without reloading (see layouts/default.vue)
                dashboard.postMessage({type: "navigate", path: url.pathname + url.search})
                return
            }
            // Another page (e.g. sign in) loads the view, which restores it after signing in
            const other = windows[0]
            if (other) {
                await other.focus()
                if (await other.navigate(url.href).catch(() => null)) return
            }
            return self.clients.openWindow(url.href)
        })()
    )
})
