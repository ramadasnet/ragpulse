/** Cookie holding the admin page to open after signing in (set by the login page, read by the login handler). */
export const LOGIN_REDIRECT_COOKIE = "ragpulse-login-redirect"

/** True for an admin path on this site (`/admin/...`), so a redirect after signing in can never leave it, also after dot segments are resolved. */
export function isAdminPath(value: unknown): value is string {
    if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return false
    try {
        const url = new URL(value, "https://admin.invalid")
        return url.origin === "https://admin.invalid" && /^\/admin(?:\/|$)/.test(url.pathname)
    } catch {
        return false
    }
}

/** Origin of an absolute URL (`https://example.com`), or an empty string when empty or invalid. */
export function urlOrigin(url: unknown): string {
    try {
        return url ? new URL(String(url)).origin : ""
    } catch {
        return ""
    }
}
