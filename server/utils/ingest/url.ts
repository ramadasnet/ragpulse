// Web page fetcher + same-site crawler. Pure module (no Nuxt auto-imports).
import {createHash} from "node:crypto"
import type {IngestDetail} from "#shared/types"
import {binaryMimeFromName, binaryMimeFromType, MAX_BINARY_BYTES, type BinaryMime} from "./binary"
import {tidyMarkdown, htmlToMarkdown, prepareMarkdownFile} from "./markdown"
import {HostThrottle, parseRetryAfter} from "./throttle"
import {emptyFetchOutcome, type FetchContext, type FetchOutcome, type FetchedDocument} from "./types"
import {safeFetch} from "../public-url"

const MAX_BYTES = 5 * 1024 * 1024
/** Cap sitemap XML reads to protect memory on small VMs */
const MAX_SITEMAP_BYTES = 2 * 1024 * 1024
/** Cap sitemap files fetched per crawl so strict hosts don't burn their rate-limit budget upfront */
const MAX_SITEMAPS = 3
/** Cap diagnostic skipped entries kept in memory */
const MAX_SKIPPED_LOG = 200
const TIMEOUT_MS = 20_000
/** Parallel requests while crawling (drops to 1 automatically once a host rate-limits or sets Crawl-delay) */
const CONCURRENCY = 2
export const DEFAULT_REQUEST_INTERVAL_MS = 500
/** Retries of a request answered with 429 (or 503 with Retry-After) */
const MAX_RETRIES = 3
/** Longer Retry-After values are not waited for: the page keeps its previous version until the next sync */
const MAX_RETRY_WAIT_MS = 120_000
/** Pause for a host after giving up on a rate limited request */
const MAX_GIVE_UP_PAUSE_MS = 30_000
/** robots.txt Crawl-delay is honoured up to this value */
const MAX_CRAWL_DELAY_MS = 20_000
/** Stop crawling after this many pages in a row stayed rate limited */
const MAX_RATE_LIMITED_STREAK = 3
export const CRAWL_DEFAULT_MAX_PAGES = 25
export const CRAWL_MAX_PAGES = 500

const NON_HTML_EXT =
    /\.(pdf|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|cjs|map|json|xml|rss|atom|zip|gz|tgz|tar|bz2|xz|7z|rar|exe|dmg|pkg|deb|rpm|msi|apk|iso|bin|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|webm|avi|mov|mkv|flac|psd|ai|eps|docx?|xlsx?|pptx?|odt|ods|csv|wasm|jar)$/i
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|yclid)$/i

class SkipError extends Error {}
class HttpError extends Error {
    constructor(
        public status: number,
        detail?: string,
        /** Rate limited: how long the server asked us to wait */
        public retryAfterMs?: number
    ) {
        super(`HTTP ${status}${detail ? ` (${detail})` : status === 429 ? " (rate limited)" : ""}`)
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Fetch context with the per-host throttle of the current sync */
type UrlContext = FetchContext & {throttle: HostThrottle; minIntervalMs: number}

function hostOf(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return url
    }
}

/** Encodes HTTP cache validators alongside the ingest detail preset so preset changes invalidate 304 skips. */
function formatHttpVersion(detail: IngestDetail, etag: string | null, lastModified: string | null): string | undefined {
    const e = etag?.trim().slice(0, 200) || ""
    const m = lastModified?.trim().slice(0, 200) || ""
    if (!e && !m) return undefined
    return `${detail}\t${e}\t${m}`
}

/** Extracts stored HTTP cache validators when they match the current ingest detail preset. */
function parseHttpVersion(version: string | undefined, detail: IngestDetail): {etag?: string; lastModified?: string} | undefined {
    if (!version || !version.startsWith(`${detail}\t`)) return undefined
    const [, etag = "", lastModified = ""] = version.split("\t")
    if (!etag && !lastModified) return undefined
    return {...(etag ? {etag} : {}), ...(lastModified ? {lastModified} : {})}
}

/**
 * GET with per-host pacing. 429 responses (and 503 with Retry-After) slow the host down and are retried
 * after `Retry-After` (or an exponential backoff), up to `retries` times.
 */
async function politeFetch(url: string, ctx: UrlContext, headers: Record<string, string>, opts: {timeoutMs?: number; retries?: number} = {}): Promise<Response> {
    const host = hostOf(url)
    const maxRetries = opts.retries ?? MAX_RETRIES
    for (let attempt = 0; ; attempt++) {
        await ctx.throttle.wait(host, ctx.signal, ctx.minIntervalMs)
        const res = await safeFetch(url, {signal: signalFor(ctx, opts.timeoutMs), headers})
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"))
        const limited = res.status === 429 || (res.status === 503 && retryAfter !== undefined)
        if (!limited) {
            return res
        }
        await res.body?.cancel().catch(() => {})
        const backoff = Math.min(60_000, 2000 * 2 ** attempt) + Math.round(Math.random() * 500)
        const delay = retryAfter ?? backoff
        if (attempt >= maxRetries || delay > MAX_RETRY_WAIT_MS) {
            ctx.throttle.penalize(host, Math.min(delay, MAX_GIVE_UP_PAUSE_MS))
            throw new HttpError(res.status, `rate limited${retryAfter !== undefined ? `, retry after ${Math.ceil(retryAfter / 1000)}s` : ""}`, delay)
        }
        ctx.log?.(`${res.status} from ${host}, retrying ${url} in ${Math.ceil(delay / 1000)}s`)
        ctx.throttle.penalize(host, delay)
    }
}

/** Strips hash, credentials, tracking params and trailing slashes. Returns null for non-http(s) URLs. */
export function normalizeCrawlUrl(input: string, base?: string): string | null {
    try {
        const u = new URL(input, base)
        if (u.protocol !== "http:" && u.protocol !== "https:") return null
        u.hash = ""
        u.username = ""
        u.password = ""
        for (const key of [...u.searchParams.keys()]) {
            if (TRACKING_PARAM.test(key)) u.searchParams.delete(key)
        }
        if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "") || "/"
        return u.toString()
    } catch {
        return null
    }
}

function signalFor(ctx: FetchContext, ms = TIMEOUT_MS): AbortSignal {
    const timeout = AbortSignal.timeout(ms)
    return ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout
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
            throw new SkipError(`larger than ${Math.round(max / 1024 / 1024)} MB`)
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

function decode(bytes: Uint8Array, charset?: string): string {
    try {
        return new TextDecoder(charset || "utf-8").decode(bytes)
    } catch {
        return new TextDecoder().decode(bytes)
    }
}

interface Resource {
    finalUrl: string
    type: string
    text: string
    /** Set when the server answered 304 Not Modified */
    notModified?: boolean
    /** Stored HTTP cache validator (ETag / Last-Modified) for future conditional requests */
    version?: string
    /** Set for PDFs and images */
    binary?: {mime: BinaryMime; bytes: Uint8Array}
}

async function fetchText(
    url: string,
    ctx: UrlContext,
    opts: {
        accept: string
        textual: (type: string, url: string) => boolean
        binary?: (type: string, url: string) => BinaryMime | undefined
        timeoutMs?: number
        retries?: number
        maxBytes?: number
        conditional?: {etag?: string; lastModified?: string}
    }
): Promise<Resource> {
    const headers: Record<string, string> = {"User-Agent": ctx.userAgent, Accept: opts.accept, "Accept-Language": "en;q=1, *;q=0.5"}
    if (opts.conditional?.etag) headers["If-None-Match"] = opts.conditional.etag
    if (opts.conditional?.lastModified) headers["If-Modified-Since"] = opts.conditional.lastModified
    const res = await politeFetch(url, ctx, headers, {timeoutMs: opts.timeoutMs, retries: opts.retries})
    const finalUrl = res.url || url
    if (res.status === 304) {
        await res.body?.cancel().catch(() => {})
        return {finalUrl, type: "", text: "", notModified: true}
    }
    if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        throw new HttpError(res.status)
    }
    const contentType = res.headers.get("content-type") || ""
    const type = contentType.split(";")[0]!.trim().toLowerCase()
    const mime = opts.binary?.(type, finalUrl)
    const maxBytes = mime ? MAX_BINARY_BYTES : (opts.maxBytes ?? MAX_BYTES)
    const length = Number(res.headers.get("content-length") || 0)
    if (length > maxBytes) {
        await res.body?.cancel().catch(() => {})
        throw new SkipError(`larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    }
    const version = formatHttpVersion(ctx.detail ?? "balanced", res.headers.get("etag"), res.headers.get("last-modified"))
    if (mime) return {finalUrl, type, text: "", version, binary: {mime, bytes: await readLimited(res, maxBytes)}}
    if (!opts.textual(type, finalUrl)) {
        await res.body?.cancel().catch(() => {})
        throw new SkipError(`unsupported content type ${type || "unknown"}`)
    }
    const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
    return {finalUrl, type, text: decode(await readLimited(res, maxBytes), charset), version}
}

const isMarkdownUrl = (url: string) => /\.(md|mdx|markdown)(\?|$)/i.test(url)

function isPageType(type: string, url: string): boolean {
    if (!type) return !NON_HTML_EXT.test(new URL(url).pathname)
    return (
        type === "text/html" ||
        type === "application/xhtml+xml" ||
        type === "text/plain" ||
        type === "text/markdown" ||
        type === "text/x-markdown" ||
        type === "application/json" ||
        type === "application/ld+json" ||
        (type === "application/octet-stream" && isMarkdownUrl(url))
    )
}

function lastSegment(url: string): string {
    try {
        const u = new URL(url)
        return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname)
    } catch {
        return url
    }
}

/** Converts a fetched resource into markdown (+ discovered links for HTML). */
function toDocument(res: Resource, detail?: IngestDetail): {title: string; markdown: string; links: string[]} {
    const looksHtml = /^\s*(<!doctype html|<html|<head|<body)/i.test(res.text.slice(0, 500))
    if (res.type === "text/html" || res.type === "application/xhtml+xml" || (looksHtml && !isMarkdownUrl(res.finalUrl))) {
        return htmlToMarkdown(res.text, res.finalUrl, {detail})
    }
    if (res.type.includes("markdown") || isMarkdownUrl(res.finalUrl)) {
        const {title, markdown} = prepareMarkdownFile(res.text, {mdx: /\.mdx(\?|$)/i.test(res.finalUrl), detail})
        return {title: title || lastSegment(res.finalUrl), markdown, links: []}
    }
    if (res.type.includes("json")) {
        let pretty = res.text
        try {
            pretty = JSON.stringify(JSON.parse(res.text), null, 2)
        } catch {}
        return {title: lastSegment(res.finalUrl), markdown: `\`\`\`json\n${pretty.trim()}\n\`\`\``, links: []}
    }
    const text = tidyMarkdown(res.text)
    const firstLine =
        text
            .split("\n")
            .find((l) => l.trim())
            ?.trim() || ""
    return {title: firstLine.length > 3 && firstLine.length <= 120 ? firstLine : lastSegment(res.finalUrl), markdown: text, links: []}
}

/** Like `toDocument`, also converting PDFs and images. Throws `SkipError` for files that aren't indexed. */
async function toPageDocument(res: Resource, ctx: FetchContext): Promise<{title: string; markdown: string; links: string[]}> {
    if (!res.binary) return toDocument(res, ctx.detail)
    const name = lastSegment(res.finalUrl)
    const extracted = await ctx.extractBinary!({name, ...res.binary})
    if ("skipped" in extracted) throw new SkipError(extracted.skipped)
    return {title: extracted.title || name, markdown: tidyMarkdown(extracted.markdown), links: []}
}

// ---------- robots.txt ----------

interface RobotsRule {
    allow: boolean
    regex: RegExp
    length: number
}

interface Robots {
    rules: RobotsRule[]
    sitemaps: string[]
    /** Crawl-delay of the matching group, in milliseconds */
    crawlDelayMs?: number
}

interface RobotsGroup {
    agents: string[]
    rules: RobotsRule[]
    crawlDelayMs?: number
}

/** Product token of a User-Agent, used to find its robots.txt group: `RAGPulseBot/1.0 (+…)` → `ragpulsebot`. */
export function robotsAgent(userAgent: string): string {
    return (userAgent.trim().split(/[\/\s;(]/)[0] || "ragpulsebot").toLowerCase()
}

export function parseRobotsTxt(text: string, agent = "ragpulsebot"): Robots {
    const groups: RobotsGroup[] = []
    const sitemaps: string[] = []
    let current: RobotsGroup | null = null
    let lastWasAgent = false
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, "").trim()
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line)
        if (!m) continue
        const key = m[1]!.toLowerCase()
        const value = m[2]!.trim()
        if (key === "sitemap") {
            if (value) sitemaps.push(value)
            continue
        }
        if (key === "user-agent") {
            if (!current || !lastWasAgent) {
                current = {agents: [], rules: []}
                groups.push(current)
            }
            current.agents.push(value.toLowerCase())
            lastWasAgent = true
            continue
        }
        lastWasAgent = false
        if (current && key === "crawl-delay") {
            const seconds = Number(value)
            if (Number.isFinite(seconds) && seconds > 0) current.crawlDelayMs = Math.round(seconds * 1000)
            continue
        }
        if (!current || (key !== "allow" && key !== "disallow") || !value) continue
        const pattern = value.replace(/[.+?^${}()|[\]\\]/g, (c, i: number) => (c === "$" && i === value.length - 1 ? "$" : `\\${c}`)).replace(/\*/g, ".*")
        current.rules.push({allow: key === "allow", regex: new RegExp(`^${pattern}`), length: value.length})
    }
    const group = groups.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a))) || groups.find((g) => g.agents.includes("*"))
    return {rules: group?.rules ?? [], sitemaps, ...(group?.crawlDelayMs ? {crawlDelayMs: group.crawlDelayMs} : {})}
}

function robotsAllows(robots: Robots | null, url: string): boolean {
    if (!robots?.rules.length) return true
    const u = new URL(url)
    const path = u.pathname + u.search
    let best: RobotsRule | null = null
    for (const rule of robots.rules) {
        if (rule.regex.test(path) && (!best || rule.length > best.length || (rule.length === best.length && rule.allow))) best = rule
    }
    return !best || best.allow
}

async function loadRobots(origin: string, ctx: UrlContext): Promise<Robots | null> {
    try {
        const res = await fetchText(`${origin}/robots.txt`, ctx, {
            accept: "text/plain",
            textual: (t) => !t || t.startsWith("text/"),
            timeoutMs: 8000,
            retries: 0,
            maxBytes: 512 * 1024
        })
        return parseRobotsTxt(res.text, robotsAgent(ctx.userAgent))
    } catch {
        return null
    }
}

const SITEMAP_LOC_RE = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi

function decodeXmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
}

async function loadSitemapUrls(sitemapUrls: string[], ctx: UrlContext, limit: number): Promise<string[]> {
    const urls: string[] = []
    const queue = [...new Set(sitemapUrls)].filter((u) => !/\.gz(\?|$)/i.test(u))
    const visited = new Set<string>()
    while (queue.length && visited.size < MAX_SITEMAPS && urls.length < limit && !ctx.signal?.aborted) {
        const url = queue.shift()!
        if (visited.has(url)) continue
        if (ctx.throttle.isPenalized(hostOf(url))) break
        visited.add(url)
        try {
            const res = await fetchText(url, ctx, {
                accept: "application/xml, text/xml",
                textual: (t) => !t || t.includes("xml") || t.startsWith("text/"),
                timeoutMs: 10_000,
                retries: 0,
                maxBytes: MAX_SITEMAP_BYTES
            })
            const isIndex = /<sitemapindex/i.test(res.text)
            SITEMAP_LOC_RE.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = SITEMAP_LOC_RE.exec(res.text)) !== null) {
                const loc = decodeXmlEntities(m[1]!)
                if (isIndex) {
                    if (!/\.gz(\?|$)/i.test(loc) && queue.length < MAX_SITEMAPS * 2) queue.push(loc)
                } else {
                    urls.push(loc)
                    if (urls.length >= limit) break
                }
            }
        } catch (err) {
            if (err instanceof HttpError && (err.status === 429 || err.status === 503)) break
        }
    }
    return urls
}

/**
 * Determines the crawl directory prefix from the start URL's path and links discovered on it.
 * Extensionless paths like `/owner/repo` stay scoped to `/owner/repo/` when child links exist under it,
 * while leaf pages like `/docs/intro` (linking only to siblings under `/docs/`) fall back to `/docs/`.
 */
export function resolveCrawlDir(scopePath: string, origin: string, links: string[]): string {
    if (scopePath === "/" || scopePath.endsWith("/")) return scopePath
    const parent = scopePath.slice(0, scopePath.lastIndexOf("/") + 1)
    const last = scopePath.slice(scopePath.lastIndexOf("/") + 1)
    if (/\.[^/.]{1,8}$/.test(last)) return parent
    const childPrefix = `${scopePath}/`
    const hasChild = links.some((raw) => {
        try {
            const u = new URL(raw, origin)
            return u.origin === origin && u.pathname.startsWith(childPrefix)
        } catch {
            return false
        }
    })
    return hasChild ? childPrefix : parent
}

// ---------- public API ----------

function classifyError(err: any): string {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timed out"
    return String(err?.message || err).slice(0, 200)
}

/**
 * Fetches a single URL, or crawls same-site pages below the start URL's directory when `crawl` is set.
 * Requests to a host are spaced by `ctx.requestIntervalMs` (or the robots.txt Crawl-delay, if longer).
 */
export async function fetchUrlSource(startUrl: string, options: {crawl?: boolean; maxPages?: number}, fetchCtx: FetchContext): Promise<FetchOutcome> {
    const minIntervalMs = Math.max(0, fetchCtx.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS)
    const ctx: UrlContext = {...fetchCtx, throttle: fetchCtx.throttle ?? new HostThrottle(minIntervalMs), minIntervalMs}
    const detail = ctx.detail ?? "balanced"
    const outcome = emptyFetchOutcome()
    const start = normalizeCrawlUrl(startUrl)
    if (!start) throw new Error("Invalid URL (only http and https are supported)")

    const recordSkipped = (ref: string, reason: string) => {
        if (outcome.skipped.length < MAX_SKIPPED_LOG) outcome.skipped.push({ref, reason})
    }

    const seenContent = new Set<string>()
    const indexedUrls = new Set<string>()
    let indexedCount = 0
    const addDocument = async (ref: string, finalUrl: string, doc: {title: string; markdown: string}, version?: string) => {
        if (!doc.markdown.trim()) {
            recordSkipped(ref, "no readable content")
            return
        }
        const hash = createHash("sha256").update(doc.markdown).digest("hex")
        if (seenContent.has(hash)) {
            recordSkipped(ref, "duplicate content")
            return
        }
        seenContent.add(hash)
        const normalizedFinal = normalizeCrawlUrl(finalUrl)
        if (normalizedFinal) indexedUrls.add(normalizedFinal)
        indexedCount++
        const document: FetchedDocument = {ref, url: finalUrl, title: doc.title || lastSegment(finalUrl), markdown: doc.markdown, ...(version ? {version} : {})}
        if (ctx.onDocument) {
            await ctx.onDocument(document)
            ;(outcome.streamedRefs ??= []).push(ref)
        } else {
            outcome.documents.push(document)
        }
    }

    const fetchPage = (url: string, conditional?: {etag?: string; lastModified?: string}) =>
        fetchText(url, ctx, {
            accept: `text/html,application/xhtml+xml,text/markdown;q=0.9,text/plain;q=0.8,${ctx.extractBinary ? "application/pdf;q=0.7,application/vnd.openxmlformats-officedocument.*;q=0.7,image/*;q=0.6," : ""}*/*;q=0.5`,
            textual: isPageType,
            binary: ctx.extractBinary ? (type, finalUrl) => binaryMimeFromType(type, new URL(finalUrl).pathname) : undefined,
            conditional
        })

    // The start page: failures are fatal (keeps the existing index), skips are reported
    let first: Resource
    let firstDoc: Awaited<ReturnType<typeof toPageDocument>>
    try {
        // Single-page sources can use ETag / Last-Modified to skip unchanged downloads completely
        const conditional = !options.crawl ? parseHttpVersion(ctx.knownVersions?.get(start), detail) : undefined
        first = await fetchPage(start, conditional)
        if (first.notModified) {
            ;(outcome.unchanged ??= []).push(start)
            return outcome
        }
        firstDoc = await toPageDocument(first, ctx)
    } catch (err: any) {
        if (err instanceof SkipError) {
            recordSkipped(start, err.message)
            return outcome
        }
        throw new Error(`Could not fetch ${start}: ${classifyError(err)}`)
    }
    await addDocument(start, first.finalUrl, firstDoc, first.version)
    if (!options.crawl || ctx.signal?.aborted) return outcome

    const maxPages = Math.min(CRAWL_MAX_PAGES, Math.max(1, options.maxPages ?? CRAWL_DEFAULT_MAX_PAGES))
    const scopeUrl = new URL(first.finalUrl)
    const origin = scopeUrl.origin
    const dir = resolveCrawlDir(scopeUrl.pathname, origin, firstDoc.links)
    const inScope = (url: string) => {
        const u = new URL(url)
        return u.origin === origin && (u.pathname.startsWith(dir) || `${u.pathname}/` === dir)
    }

    const robots = await loadRobots(origin, ctx)
    if (robots?.crawlDelayMs) ctx.throttle.setMinInterval(scopeUrl.host, Math.min(MAX_CRAWL_DELAY_MS, robots.crawlDelayMs))
    const crawlable = (url: string) => {
        const path = new URL(url).pathname
        return !NON_HTML_EXT.test(path) || (!!ctx.extractBinary && !!binaryMimeFromName(path))
    }
    const maxSeen = Math.min(10_000, Math.max(maxPages * 20, 1000))
    const maxQueued = Math.min(2_000, Math.max(maxPages * 4, 200))
    const seen = new Set<string>([start])
    const finalStart = normalizeCrawlUrl(first.finalUrl)
    if (finalStart) seen.add(finalStart)
    // Two-tier queue: unindexed URLs run first so incomplete crawls make forward progress on retry;
    // already-indexed URLs follow oldest-first.
    const newQueue: string[] = []
    const knownQueue: string[] = []
    const queueSize = () => newQueue.length + knownQueue.length
    const enqueue = (raw: string, base?: string) => {
        if (seen.size >= maxSeen) return
        const url = normalizeCrawlUrl(raw, base)
        if (!url || seen.has(url)) return
        seen.add(url)
        if (!inScope(url) || !crawlable(url) || !robotsAllows(robots, url)) return
        if (ctx.knownUpdatedAt?.has(url)) {
            if (knownQueue.length < maxQueued) knownQueue.push(url)
        } else if (newQueue.length < maxQueued) {
            newQueue.push(url)
        }
    }
    const dequeue = (): string | undefined => {
        if (newQueue.length) return newQueue.shift()
        if (!knownQueue.length) return undefined
        let oldestIdx = 0
        let oldestAt = ctx.knownUpdatedAt?.get(knownQueue[0]!) ?? 0
        for (let i = 1; i < knownQueue.length; i++) {
            const at = ctx.knownUpdatedAt?.get(knownQueue[i]!) ?? 0
            if (at < oldestAt) {
                oldestAt = at
                oldestIdx = i
            }
        }
        return knownQueue.splice(oldestIdx, 1)[0]
    }

    for (const link of firstDoc.links) enqueue(link)
    // Only probe sitemaps when links from the start page didn't already fill the crawl budget
    if (queueSize() < maxPages && !ctx.throttle.isPenalized(scopeUrl.host) && !ctx.signal?.aborted) {
        const sitemapUrls = await loadSitemapUrls([...(robots?.sitemaps ?? []), `${origin}/sitemap.xml`], ctx, Math.min(2000, maxPages * 10))
        for (const url of sitemapUrls) enqueue(url)
    }

    let processed = 1
    let active = 0
    let rateLimitedStreak = 0
    const maxWorkers = () => (ctx.throttle.isPenalized(scopeUrl.host) || (robots?.crawlDelayMs ?? 0) > 0 ? 1 : CONCURRENCY)
    const worker = async () => {
        while (processed < maxPages && !ctx.signal?.aborted && !outcome.incomplete) {
            if (active >= maxWorkers()) {
                await sleep(100)
                continue
            }
            const url = dequeue()
            if (!url) {
                if (!active) return
                await sleep(100)
                continue
            }
            processed++
            active++
            try {
                const res = await fetchPage(url)
                const finalUrl = normalizeCrawlUrl(res.finalUrl)
                if (finalUrl && finalUrl !== url) {
                    if (!inScope(finalUrl)) {
                        recordSkipped(url, "redirects outside the crawl scope")
                        continue
                    }
                    if (seen.has(finalUrl) && indexedUrls.has(finalUrl)) {
                        recordSkipped(url, "duplicate (redirect)")
                        continue
                    }
                    seen.add(finalUrl)
                }
                const doc = await toPageDocument(res, ctx)
                for (const link of doc.links) enqueue(link)
                await addDocument(url, res.finalUrl, doc, res.version)
                rateLimitedStreak = 0
            } catch (err: any) {
                const rateLimited = err instanceof HttpError && (err.status === 429 || err.status === 503)
                rateLimitedStreak = rateLimited ? rateLimitedStreak + 1 : 0
                // The host asks to come back later than we wait, or keeps refusing: stop instead of hammering it
                const backLater = rateLimited && (err.retryAfterMs ?? 0) > MAX_RETRY_WAIT_MS
                if ((backLater || rateLimitedStreak >= MAX_RATE_LIMITED_STREAK) && !outcome.incomplete) {
                    // Pages not reached keep their previous version (see `incomplete`)
                    outcome.incomplete = `${new URL(url).host} keeps rate limiting requests (HTTP ${err.status}), crawl stopped after ${processed} page(s) and continues on the next sync`
                }
                if (err instanceof SkipError) recordSkipped(url, err.message)
                else if (err instanceof HttpError && (err.status === 404 || err.status === 410)) recordSkipped(url, err.message)
                else {
                    outcome.failedRefs.push(url)
                    if (outcome.errors.length < 5) outcome.errors.push(`${url}: ${classifyError(err)}`)
                }
            } finally {
                active--
            }
        }
    }
    await Promise.all(Array.from({length: CONCURRENCY}, worker))
    // An interrupted crawl must never let the caller delete unreached previously-indexed pages
    if (ctx.signal?.aborted && !outcome.incomplete && queueSize() > 0) {
        outcome.incomplete = `crawl interrupted after ${processed} page(s), continues on the next sync`
    }
    ctx.log?.(`crawled ${processed} page(s) from ${start}: ${indexedCount} indexed, ${outcome.skipped.length} skipped, ${outcome.failedRefs.length} failed${outcome.incomplete ? ` (${outcome.incomplete})` : ""}`)
    return outcome
}
