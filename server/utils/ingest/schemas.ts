// Validation schemas + helpers for the knowledge API routes.
import {z} from "zod"
import {isRefreshInterval, type Source, type SourceOptions, type SourceType} from "#shared/types"
import {driveFolderUrl, parseDriveFolderId} from "#shared/utils/drive"
import {parseServiceAccountKey} from "./drive"
import {CRAWL_MAX_PAGES} from "./url"
import {publicUrlIssue} from "../public-url"

const globList = z.array(z.string().trim().min(1).max(300)).max(50)

export const sourceOptionsSchema = z.object({
    branch: z
        .string()
        .trim()
        .max(200)
        .regex(/^([\w][\w./-]*)?$/, "Invalid branch name")
        .optional(),
    include: globList.optional(),
    exclude: globList.optional(),
    accessToken: z.string().trim().max(1000).optional(),
    code: z.boolean().optional(),
    crawl: z.boolean().optional(),
    maxPages: z.number().int().min(1).max(CRAWL_MAX_PAGES).optional(),
    serviceAccountKey: z.string().trim().max(10000).optional()
})

const refreshSchema = z.number().refine(isRefreshInterval, "Manual only (0) or 1 to 336 hours").nullable()

export const sourceCreateSchema = z.object({
    type: z.enum(["url", "git", "drive"]),
    url: z.string().trim().min(1).max(2000),
    title: z.string().trim().max(200).optional(),
    refreshIntervalHours: refreshSchema.optional(),
    options: sourceOptionsSchema.optional()
})

export const sourcePatchSchema = z.object({
    title: z.string().trim().max(200).optional(),
    url: z.string().trim().min(1).max(2000).optional(),
    refreshIntervalHours: refreshSchema.optional(),
    options: sourceOptionsSchema.optional()
})

/** Validates and normalizes a source URL. Throws a 400 error with a readable message. */
export function validateSourceUrl(type: SourceType, input: string): string {
    if (type === "drive") {
        const folderId = parseDriveFolderId(input)
        if (!folderId) throw createError({statusCode: 400, statusMessage: "Enter a Google Drive folder link"})
        return driveFolderUrl(folderId)
    }
    let url: URL
    try {
        url = new URL(input)
    } catch {
        throw createError({statusCode: 400, statusMessage: "Invalid URL"})
    }
    const issue = publicUrlIssue(url)
    if (issue) throw createError({statusCode: 400, statusMessage: `URL ${issue}`})
    if (type === "git") {
        if (url.protocol !== "https:") throw createError({statusCode: 400, statusMessage: "Git repositories must use an https:// URL"})
        if (url.username || url.password) throw createError({statusCode: 400, statusMessage: "Do not put credentials in the URL, use the access token field"})
        url.hash = ""
        url.search = ""
        return url.href.replace(/\/+$/, "")
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw createError({statusCode: 400, statusMessage: "Only http:// and https:// URLs are supported"})
    if (url.username || url.password) throw createError({statusCode: 400, statusMessage: "URLs with credentials are not supported"})
    url.hash = ""
    return url.href
}

/** Default title from a URL: `owner/repo` for git, `host/path` for pages. */
export function defaultSourceTitle(type: SourceType, url: string): string {
    if (type === "drive") return "Google Drive folder"
    try {
        const u = new URL(url)
        const path = u.pathname.replace(/\/+$/, "").replace(/\.git$/, "")
        if (type === "git") return path.split("/").filter(Boolean).slice(-2).join("/") || u.hostname
        return `${u.hostname.replace(/^www\./, "")}${path}`.slice(0, 200)
    } catch {
        return url.slice(0, 200)
    }
}

function cleanGlobs(list?: string[]): string[] | undefined {
    const out = [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))]
    return out.length ? out : undefined
}

/**
 * Builds the stored options for a source type, keeping only relevant keys.
 * `accessToken` and `serviceAccountKey`: undefined = keep `previous`, '' = remove.
 */
export function buildSourceOptions(type: SourceType, input: z.infer<typeof sourceOptionsSchema> | undefined, previous: SourceOptions = {}): SourceOptions {
    const merged = {...previous, ...(input ?? {})}
    if (type === "url") {
        const options: SourceOptions = {crawl: !!merged.crawl}
        if (merged.crawl) options.maxPages = merged.maxPages ?? 25
        return options
    }
    if (type === "drive") {
        const options: SourceOptions = {}
        const raw = input?.serviceAccountKey === undefined ? previous.serviceAccountKey : input.serviceAccountKey
        if (raw) {
            try {
                options.serviceAccountKey = JSON.stringify(parseServiceAccountKey(raw))
            } catch (err: any) {
                throw createError({statusCode: 400, statusMessage: String(err?.message || "Invalid service account key")})
            }
        }
        return options
    }
    const options: SourceOptions = {}
    if (merged.code === false) options.code = false
    if (merged.branch) options.branch = merged.branch
    const include = cleanGlobs(merged.include)
    const exclude = cleanGlobs(merged.exclude)
    if (include) options.include = include
    if (exclude) options.exclude = exclude
    const token = input?.accessToken === undefined ? previous.accessToken : input.accessToken
    if (token) options.accessToken = token
    return options
}

/** A new source, queued for its first sync. */
export function newSource(projectId: string, input: {type: SourceType; url: string; title?: string; refreshIntervalHours?: number | null; options?: SourceOptions}): Source {
    const now = new Date()
    return {
        _id: newId(),
        projectId,
        type: input.type,
        title: input.title || defaultSourceTitle(input.type, input.url),
        url: input.url,
        options: input.options ?? {},
        refreshIntervalHours: input.refreshIntervalHours ?? null,
        status: "queued",
        nextSyncAt: new Date(0),
        documentCount: 0,
        chunkCount: 0,
        createdAt: now,
        updatedAt: now
    }
}

export const faqInputSchema = z.object({
    question: z.string().trim().min(1, "Question is required").max(1000),
    answer: z.string().trim().min(1, "Answer is required").max(20000)
})

export const faqPatchInputSchema = faqInputSchema.partial()

export const faqImportInputSchema = z.object({
    items: z.array(faqInputSchema).min(1).max(1000)
})

export const faqParseInputSchema = z.object({
    text: z.string().trim().min(1).max(50_000)
})

export const knowledgeSearchSchema = z.object({
    query: z.string().trim().min(1).max(2000),
    limit: z.number().int().min(1).max(30).optional()
})

/** Parses a body with a zod schema, throwing a 400 with the first issue as message. */
export async function readIngestBody<T extends z.ZodType>(event: Parameters<typeof readBody>[0], schema: T): Promise<z.infer<T>> {
    const body = await readBody(event).catch(() => undefined)
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue?.path?.length ? `${issue.path.join(".")}: ` : ""
        throw createError({statusCode: 400, statusMessage: `${path}${issue?.message || "Invalid request body"}`})
    }
    return parsed.data
}
