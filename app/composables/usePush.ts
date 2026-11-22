import type {PushEvent} from "#shared/types"

/** Id of a device on the server: sha256 (hex) of its push endpoint. */
async function deviceId(subscription: PushSubscription): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Decodes a base64url VAPID public key into bytes for `pushManager.subscribe`. */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return bytes
}

/** Push subscription of this browser / installed app, if notifications were turned on. */
async function currentSubscription(): Promise<PushSubscription | null> {
    if (!pushSupported()) return null
    const registration = await navigator.serviceWorker.getRegistration("/")
    return (await registration?.pushManager.getSubscription()) ?? null
}

/** Whether this browser can receive Web Push (iOS only inside the app added to the Home Screen). */
export function pushSupported(): boolean {
    return import.meta.client && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

/** Web Push notifications of the current device: subscribing, the notifications it receives and unsubscribing. */
export function usePush() {
    /** Notifications this device receives, or null while notifications are off on it */
    async function load(): Promise<PushEvent[] | null> {
        const subscription = await currentSubscription()
        if (!subscription) return null
        try {
            return (await $fetch<{events: PushEvent[]}>(`/api/push/devices/${await deviceId(subscription)}`)).events
        } catch (err: any) {
            // Subscribed in the browser but unknown to the server (signed out, removed): it is re-saved when turned on
            if (err?.statusCode === 404) return null
            throw err
        }
    }

    /** Creates a fresh browser subscription (replacing any stale one) and saves it on the server. */
    async function subscribeFresh(events: PushEvent[]): Promise<PushSubscription> {
        await navigator.serviceWorker.register("/sw.js", {scope: "/"})
        const registration = await navigator.serviceWorker.ready
        const {publicKey} = await $fetch<{publicKey: string}>("/api/push/key")
        const existing = await registration.pushManager.getSubscription()
        // Always replace an existing subscription so a stale or expired endpoint (or regenerated VAPID key) isn't reused
        if (existing) await existing.unsubscribe().catch(() => {})
        const subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: decodeBase64Url(publicKey)})
        await save(subscription, events)
        return subscription
    }

    /** Asks for permission (call it straight from a click), subscribes and saves the device with `events`. */
    async function enable(events: PushEvent[]): Promise<void> {
        // Must be the first call: browsers only show the prompt during the user's click
        const permission = await Notification.requestPermission()
        if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked. Allow them in the browser or system settings." : "Notifications were not allowed")
        await subscribeFresh(events)
    }

    async function save(subscription: PushSubscription, events: PushEvent[]): Promise<void> {
        const {endpoint, keys} = subscription.toJSON()
        await $fetch("/api/push/devices", {method: "PUT", body: {endpoint, keys, events}})
    }

    /** Changes the notifications of this device. */
    async function update(events: PushEvent[]): Promise<void> {
        const subscription = await currentSubscription()
        if (!subscription) throw new Error("Notifications are off on this device")
        await save(subscription, events)
    }

    /** Turns notifications off on this device (also when signing out, so the next user doesn't receive them). */
    async function disable(): Promise<void> {
        const subscription = await currentSubscription()
        if (!subscription) return
        const id = await deviceId(subscription)
        await subscription.unsubscribe().catch(() => {})
        await $fetch(`/api/push/devices/${id}`, {method: "DELETE"}).catch(() => {})
    }

    /** Sends a test notification; if the push service reports an expired subscription (410), renews it and retries once. */
    async function test(events: PushEvent[]): Promise<void> {
        const subscription = await currentSubscription()
        if (!subscription) throw new Error("Notifications are off on this device")
        try {
            await $fetch(`/api/push/devices/${await deviceId(subscription)}/test`, {method: "POST"})
        } catch (err: any) {
            if ((err?.statusCode ?? err?.data?.statusCode) !== 410) throw err
            const renewed = await subscribeFresh(events)
            try {
                await $fetch(`/api/push/devices/${await deviceId(renewed)}/test`, {method: "POST"})
            } catch (retryErr: any) {
                if ((retryErr?.statusCode ?? retryErr?.data?.statusCode) === 410) await renewed.unsubscribe().catch(() => {})
                throw retryErr
            }
        }
    }

    return {load, enable, update, disable, test}
}
