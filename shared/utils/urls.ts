/** Cookie holding the admin page to open after signing in (set by the login page, read by the login handler). */
export const LOGIN_REDIRECT_COOKIE = "ragpulse-login-redirect"

/** True for an admin path on this site (`/admin/...`), so a redirect after signing in can never leave it. */
export function isAdminPath(value: unknown): value is string {
    return typeof value === "string" && /^\/admin(?:[/?#]|$)/.test(value) && !value.includes("\\")
}

/** Origin of an absolute URL (`https://example.com`), or an empty string when empty or invalid. */
export function urlOrigin(url: unknown): string {
    try {
        return url ? new URL(String(url)).origin : ""
    } catch {
        return ""
    }
}
