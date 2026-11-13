// Google Drive folder fetcher: service account auth → recursive folder listing → markdown. Pure module (no Nuxt auto-imports).
import {createHash, createSign} from "node:crypto"
import {binaryMimeFromName, binaryMimeFromType, DOCX_MIME, MAX_BINARY_BYTES, PPTX_MIME, XLSX_MIME, type BinaryMime} from "./binary"
import {isCodeFile, textFileToMarkdown} from "./git"
import {tidyMarkdown} from "./markdown"
import {csvToMarkdown} from "./office"
import {abortableSleep, parseRetryAfter} from "./throttle"
import {emptyFetchOutcome, type FetchContext, type FetchOutcome} from "./types"
import {parseDriveFolderId} from "../../../shared/utils/drive"

const API = "https://www.googleapis.com/drive/v3"
const TOKEN_URI = "https://oauth2.googleapis.com/token"
const TOKEN_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
const FOLDER_MIME = "application/vnd.google-apps.folder"
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
const MAX_FILES = 3000
const MAX_DEPTH = 20
/** Same text cap as git files */
const MAX_TEXT_BYTES = 300 * 1024
const MAX_ATTEMPTS = 5
const CONCURRENCY = 4

/** Bump to re-index all Drive files after converter changes (combined with the file's Drive version) */
export const DRIVE_CONVERTER_VERSION = "2"

const FILE_FIELDS = "id,name,mimeType,version,size,modifiedTime,webViewLink,shortcutDetails(targetId,targetMimeType)"

export interface ServiceAccountKey {
    client_email: string
    private_key: string
    project_id?: string
}

/**
 * Parses a service account key from a JSON object (runtimeConfig destr-parses env JSON), a JSON string,
 * or base64-encoded JSON. Throws an Error with a readable message. Never logs the key.
 */
export function parseServiceAccountKey(raw: unknown): ServiceAccountKey {
    let value: any = raw
    if (typeof raw === "string") {
        const trimmed = raw.trim()
        if (!trimmed) throw new Error("The service account key is empty")
        try {
            value = JSON.parse(trimmed)
        } catch {
            try {
                value = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"))
            } catch {
                throw new Error("The service account key is not valid JSON (paste the JSON key or a base64-encoded version)")
            }
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The service account key must be a JSON object")
    if (value.type !== undefined && value.type !== "service_account") throw new Error('The key is not a service account key ("type" must be "service_account")')
    // A pasted key must not be able to redirect signed assertions to a different token endpoint
    if (value.token_uri !== undefined && value.token_uri !== TOKEN_URI) throw new Error("The service account key has an unexpected token_uri")
    const client_email = String(value.client_email ?? "").trim()
    const private_key = String(value.private_key ?? "").replace(/\\n/g, "\n")
    if (!client_email.includes("@")) throw new Error("The service account key has no valid client_email")
    if (!private_key.includes("PRIVATE KEY")) throw new Error("The service account key has no valid private_key")
    const key: ServiceAccountKey = {client_email, private_key}
    if (value.project_id) key.project_id = String(value.project_id)
    return key
}

// ---------- OAuth2 access token (JWT bearer grant, RS256) ----------

const tokenCache = new Map<string, {token: string; expiresAt: number}>()

/** Cache key: same email with a different private key must not share a token. */
function keyId(key: ServiceAccountKey): string {
    return `${key.client_email}:${createHash("sha256").update(key.private_key).digest("hex").slice(0, 16)}`
}

function assertion(key: ServiceAccountKey): string {
    const now = Math.floor(Date.now() / 1000)
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
    const unsigned = `${b64({alg: "RS256", typ: "JWT"})}.${b64({iss: key.client_email, scope: TOKEN_SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600})}`
    const sign = createSign("RSA-SHA256")
    sign.update(unsigned)
    return `${unsigned}.${sign.sign(key.private_key).toString("base64url")}`
}

async function accessToken(key: ServiceAccountKey, signal?: AbortSignal): Promise<string> {
    const cached = tokenCache.get(keyId(key))
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
    const res = await fetch(TOKEN_URI, {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion(key))}`,
        signal
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) throw new Error(`Google authentication failed (${res.status}${data.error_description ? `: ${String(data.error_description).slice(0, 150)}` : ""})`)
    tokenCache.set(keyId(key), {token: String(data.access_token), expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000})
    return String(data.access_token)
}

// ---------- Drive REST helpers ----------

export class DriveApiError extends Error {
    constructor(
        public status: number,
        public reasons: string[],
        detail: string
    ) {
        super(detail)
    }
}

async function driveError(res: Response): Promise<DriveApiError> {
    let reasons: string[] = []
    let detail = `HTTP ${res.status}`
    try {
        const data: any = await res.json()
        reasons = (Array.isArray(data?.error?.errors) ? data.error.errors : []).map((e: any) => String(e?.reason ?? "")).filter(Boolean)
        if (data?.error?.message) detail = String(data.error.message).slice(0, 200)
    } catch {}
    return new DriveApiError(res.status, reasons, `Google Drive request failed: ${detail}`)
}

const RETRY_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"])

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

interface DriveRequest {
    key: ServiceAccountKey
    signal?: AbortSignal
    sleep?: Sleep
}

/**
 * GET against the Drive API: the token is taken from the cache per attempt (a token that expires mid-sync
 * is replaced transparently), a 401 drops the cached token and retries once. Retries on 429, 5xx and
 * user rate limits (max 5 attempts).
 */
async function driveFetch(url: string, req: DriveRequest): Promise<Response> {
    const sleep = req.sleep ?? abortableSleep
    let tokenDropped = false
    for (let attempt = 1; ; attempt++) {
        const token = await accessToken(req.key, req.signal)
        const res = await fetch(url, {headers: {Authorization: `Bearer ${token}`}, signal: req.signal})
        if (res.ok) return res
        if (res.status === 401 && !tokenDropped) {
            tokenDropped = true
            tokenCache.delete(keyId(req.key))
            continue
        }
        const err = await driveError(res)
        const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && err.reasons.some((r) => RETRY_REASONS.has(r)))
        if (!retryable || attempt >= MAX_ATTEMPTS) throw err
        const delay = parseRetryAfter(res.headers.get("retry-after")) ?? 1000 * 2 ** (attempt - 1)
        await sleep(delay, req.signal)
    }
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
    if (!res.body) return new Uint8Array()
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let total = 0
    while (true) {
        const {done, value} = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > max) {
            await reader.cancel().catch(() => {})
            throw new Error(`larger than ${Math.round(max / 1024 / 1024)} MB`)
        }
        parts.push(value)
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of parts) {
        out.set(p, offset)
        offset += p.byteLength
    }
    return out
}

export interface DriveFolder {
    id: string
    name: string
    driveId?: string
}

/** Metadata of a Drive folder; readable errors when the link is wrong or not shared with the service account. */
export async function getDriveFolder(folderId: string, key: ServiceAccountKey, signal?: AbortSignal, sleep?: Sleep): Promise<DriveFolder> {
    try {
        const res = await driveFetch(`${API}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,driveId&supportsAllDrives=true`, {key, signal, sleep})
        const data: any = await res.json()
        if (data.mimeType !== FOLDER_MIME) throw new Error("This link is not a folder")
        const folder: DriveFolder = {id: String(data.id), name: String(data.name ?? "")}
        if (data.driveId) folder.driveId = String(data.driveId)
        return folder
    } catch (err: any) {
        const notShared = err instanceof DriveApiError && (err.status === 404 || (err.status === 403 && !err.reasons.some((r) => RETRY_REASONS.has(r))))
        if (notShared) throw new Error(`Folder not found or not shared with ${key.client_email}`)
        throw err
    }
}

// ---------- file classification ----------

interface DriveFile {
    id: string
    name: string
    mimeType: string
    version?: string
    size?: string
    modifiedTime?: string
    webViewLink?: string
    shortcutDetails?: {targetId?: string; targetMimeType?: string}
}

type Plan = {kind: "google"; exportMime: BinaryMime; fallback?: "text/plain" | "text/csv"} | {kind: "binary"; mime: BinaryMime} | {kind: "text"} | {kind: "csv"; delimiter?: string} | {kind: "skip"; reason: string}

const GOOGLE_TYPES: Record<string, {exportMime: BinaryMime; fallback?: "text/plain" | "text/csv"}> = {
    "application/vnd.google-apps.document": {exportMime: DOCX_MIME, fallback: "text/plain"},
    "application/vnd.google-apps.presentation": {exportMime: PPTX_MIME, fallback: "text/plain"},
    "application/vnd.google-apps.spreadsheet": {exportMime: XLSX_MIME, fallback: "text/csv"},
    "application/vnd.google-apps.drawing": {exportMime: "image/png"}
}

const TEXT_EXT = new Set(["md", "mdx", "markdown", "txt", "text", "html", "htm", "rst", "adoc", "asciidoc"])
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown", "text/html", "text/x-rst"])

function classify(f: DriveFile): Plan {
    const google = GOOGLE_TYPES[f.mimeType]
    if (google) return {kind: "google", ...google}
    if (f.mimeType.startsWith("application/vnd.google-apps.")) return {kind: "skip", reason: `unsupported Google file (${f.mimeType.slice(30)})`}
    const binary = binaryMimeFromName(f.name) ?? binaryMimeFromType(f.mimeType, f.name)
    if (binary) return {kind: "binary", mime: binary}
    const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase() ?? ""
    if (ext === "csv" || f.mimeType === "text/csv") return {kind: "csv"}
    if (ext === "tsv" || f.mimeType === "text/tab-separated-values") return {kind: "csv", delimiter: "\t"}
    if (TEXT_EXT.has(ext)) return {kind: "text"}
    if (isCodeFile(f.name)) return {kind: "skip", reason: "code file"}
    if (TEXT_MIMES.has(f.mimeType)) return {kind: "text"}
    return {kind: "skip", reason: `unsupported type ${f.mimeType || ext || "unknown"}`}
}

function driveTitle(f: DriveFile): string {
    const t = GOOGLE_TYPES[f.mimeType] ? f.name : f.name.replace(/\.[a-z0-9]{1,10}$/i, "")
    return (t.trim() || f.name).slice(0, 300)
}

// ---------- source fetch ----------

/**
 * Indexes all supported files of a Drive folder (recursively, incl. shared drives).
 * ref = Drive file id; files whose Drive version is still in `ctx.knownVersions` are not downloaded again.
 */
export async function fetchDriveSource(folderUrlOrId: string, options: {serviceAccountKey: ServiceAccountKey; sleep?: Sleep}, ctx: FetchContext): Promise<FetchOutcome> {
    const outcome = emptyFetchOutcome()
    outcome.unchanged = []
    const folderId = parseDriveFolderId(folderUrlOrId)
    if (!folderId) throw new Error("Invalid Google Drive folder link")
    const key = options.serviceAccountKey
    const req: DriveRequest = {key, signal: ctx.signal, sleep: options.sleep}
    const root = await getDriveFolder(folderId, key, ctx.signal, options.sleep)

    const listChildren = async (id: string): Promise<DriveFile[]> => {
        const out: DriveFile[] = []
        let pageToken: string | undefined
        do {
            const params = new URLSearchParams({
                q: `'${id}' in parents and trashed = false`,
                fields: `nextPageToken,files(${FILE_FIELDS})`,
                pageSize: "1000",
                supportsAllDrives: "true",
                includeItemsFromAllDrives: "true"
            })
            if (root.driveId) {
                params.set("corpora", "drive")
                params.set("driveId", root.driveId)
            }
            if (pageToken) params.set("pageToken", pageToken)
            const res = await driveFetch(`${API}/files?${params}`, req)
            const data: any = await res.json()
            if (Array.isArray(data.files)) out.push(...data.files)
            pageToken = data.nextPageToken
        } while (pageToken)
        return out
    }

    // BFS over folders: a visited-set guards against cycles and files with multiple parents
    const listed = new Map<string, DriveFile>()
    const shortcutTargets: string[] = []
    const visitedFolders = new Set<string>([root.id])
    const queue: Array<{id: string; depth: number}> = [{id: root.id, depth: 0}]
    while (queue.length) {
        const {id, depth} = queue.shift()!
        for (const f of await listChildren(id)) {
            if (ctx.signal?.aborted) throw new Error("Sync aborted")
            if (f.mimeType === FOLDER_MIME) {
                if (depth < MAX_DEPTH && !visitedFolders.has(f.id)) {
                    visitedFolders.add(f.id)
                    queue.push({id: f.id, depth: depth + 1})
                }
                continue
            }
            if (f.mimeType === SHORTCUT_MIME) {
                const target = f.shortcutDetails
                if (target?.targetMimeType === FOLDER_MIME) outcome.skipped.push({ref: f.id, reason: "shortcut to folder"})
                else if (target?.targetId) shortcutTargets.push(target.targetId)
                else outcome.skipped.push({ref: f.id, reason: "broken shortcut"})
                continue
            }
            if (!listed.has(f.id)) listed.set(f.id, f)
        }
    }

    // Shortcuts to files index their target
    for (const targetId of [...new Set(shortcutTargets)]) {
        try {
            const res = await driveFetch(`${API}/files/${encodeURIComponent(targetId)}?fields=${FILE_FIELDS}&supportsAllDrives=true`, req)
            const f: DriveFile = await res.json()
            if (f.mimeType === FOLDER_MIME) outcome.skipped.push({ref: targetId, reason: "shortcut to folder"})
            else if (!listed.has(f.id)) listed.set(f.id, f)
        } catch (err: any) {
            outcome.failedRefs.push(targetId)
            if (outcome.errors.length < 5) outcome.errors.push(`shortcut target: ${String(err?.message || err).slice(0, 200)}`)
        }
    }

    const all = [...listed.values()]
    const files = all.slice(0, MAX_FILES)
    for (const f of all.slice(MAX_FILES)) outcome.skipped.push({ref: f.id, reason: `file limit (${MAX_FILES}) reached`})

    const download = async (f: DriveFile, exportMime?: string, max = MAX_BINARY_BYTES): Promise<Uint8Array> => {
        const base = exportMime ? `${API}/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(exportMime)}` : `${API}/files/${encodeURIComponent(f.id)}?alt=media`
        const res = await driveFetch(`${base}&supportsAllDrives=true`, req)
        return readLimited(res, max)
    }

    const materialize = async (f: DriveFile, plan: Plan): Promise<{markdown: string} | {skipped: string}> => {
        if (plan.kind === "text" || plan.kind === "csv") {
            const text = new TextDecoder().decode(await download(f, undefined, MAX_TEXT_BYTES))
            if (plan.kind === "csv") return {markdown: csvToMarkdown(text, plan.delimiter)}
            return {markdown: textFileToMarkdown(f.name, text, driveTitle(f), ctx.detail).markdown}
        }
        let bytes: Uint8Array
        let mime: BinaryMime
        if (plan.kind === "google") {
            try {
                bytes = await download(f, plan.exportMime)
                mime = plan.exportMime
            } catch (err: any) {
                if (err instanceof DriveApiError && err.status === 403 && err.reasons.includes("exportSizeLimitExceeded") && plan.fallback) {
                    const text = new TextDecoder().decode(await download(f, plan.fallback))
                    return {markdown: plan.fallback === "text/csv" ? csvToMarkdown(text) : text}
                }
                throw err
            }
        } else {
            mime = plan.kind === "binary" ? plan.mime : DOCX_MIME
            bytes = await download(f)
        }
        const extracted = await ctx.extractBinary!({name: f.name, mime, bytes})
        return "skipped" in extracted ? {skipped: extracted.skipped} : {markdown: extracted.markdown}
    }

    const processFile = async (f: DriveFile): Promise<void> => {
        const ref = f.id
        // Google Workspace files may have no `version`; modifiedTime is the best revision available
        // The preset is part of the version: changing it converts every file again
        const version = `${DRIVE_CONVERTER_VERSION}${ctx.detail && ctx.detail !== "balanced" ? `-${ctx.detail}` : ""}:${f.version ?? f.modifiedTime ?? ""}`
        if (ctx.knownVersions?.get(ref) === version) {
            outcome.unchanged!.push(ref)
            return
        }
        const plan = classify(f)
        if (plan.kind === "skip") {
            outcome.skipped.push({ref, reason: plan.reason})
            return
        }
        const textual = plan.kind === "text" || plan.kind === "csv"
        const limit = textual ? MAX_TEXT_BYTES : MAX_BINARY_BYTES
        if ((Number(f.size ?? 0) || 0) > limit) {
            outcome.skipped.push({ref, reason: `larger than ${textual ? `${MAX_TEXT_BYTES / 1024} KB` : `${MAX_BINARY_BYTES / 1024 / 1024} MB`}`})
            return
        }
        if (!textual && !ctx.extractBinary) {
            outcome.skipped.push({ref, reason: "binary file"})
            return
        }
        const doc = await materialize(f, plan)
        if ("skipped" in doc) {
            outcome.skipped.push({ref, reason: doc.skipped})
            return
        }
        const clean = tidyMarkdown(doc.markdown)
        if (!clean) {
            outcome.skipped.push({ref, reason: "empty"})
            return
        }
        outcome.documents.push({ref, title: driveTitle(f), ...(f.webViewLink ? {url: f.webViewLink} : {}), markdown: clean, version})
    }

    const pending = [...files]
    const seen = new Set<string>()
    const worker = async () => {
        for (;;) {
            const f = pending.shift()
            if (!f) return
            if (ctx.signal?.aborted) throw new Error("Sync aborted")
            if (seen.has(f.id)) continue
            seen.add(f.id)
            try {
                await processFile(f)
            } catch (err: any) {
                if (ctx.signal?.aborted) throw err
                outcome.failedRefs.push(f.id)
                if (outcome.errors.length < 5) outcome.errors.push(`${f.name}: ${String(err?.message || err).slice(0, 200)}`)
            }
        }
    }
    await Promise.all(Array.from({length: CONCURRENCY}, worker))

    ctx.log?.(`${root.name}: ${files.length} file(s), ${outcome.documents.length} indexed, ${outcome.unchanged.length} unchanged, ${outcome.skipped.length} skipped`)
    return outcome
}
