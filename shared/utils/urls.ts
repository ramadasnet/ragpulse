/** Origin of an absolute URL (`https://example.com`), or an empty string when empty or invalid. */
export function urlOrigin(url: unknown): string {
    try {
        return url ? new URL(String(url)).origin : ""
    } catch {
        return ""
    }
}
