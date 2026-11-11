/** Base URL of the admin or chat instance (NUXT_PUBLIC_ADMIN_URL / NUXT_PUBLIC_CHAT_URL), or the current origin when unset. */
export function publicBaseUrl(app: "admin" | "chat"): string {
    const {adminUrl, chatUrl} = useRuntimeConfig().public
    const base = String((app === "admin" ? adminUrl : chatUrl) || "") || (import.meta.client ? window.location.origin : "")
    return base.replace(/\/+$/, "")
}
