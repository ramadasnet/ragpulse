// Google Drive folder link helpers, shared by the client (source modal) and the server (source validation).

const FOLDER_ID = /^[A-Za-z0-9_-]{10,}$/

/** Folder id from a Drive URL or a bare id, undefined when the input doesn't look like one. */
export function parseDriveFolderId(input: string): string | undefined {
    const value = input.trim()
    if (FOLDER_ID.test(value)) return value
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return undefined
    }
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return undefined
    const inPath = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1]
    if (inPath) return inPath
    const inQuery = url.pathname === "/open" || url.pathname === "/folderview" ? (url.searchParams.get("id") ?? undefined) : undefined
    return inQuery && FOLDER_ID.test(inQuery) ? inQuery : undefined
}

/** Canonical URL of a Drive folder, stored on the source and shown in the admin UI. */
export function driveFolderUrl(id: string): string {
    return `https://drive.google.com/drive/folders/${id}`
}
