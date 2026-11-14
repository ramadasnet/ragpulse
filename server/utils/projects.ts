import type {H3Event} from "h3"
import {z} from "zod"
import type {ChatTheme, Project, ProjectAccess, ProjectPermission, User} from "#shared/types"
import {DEFAULT_REFRESH_HOURS, DEFAULT_THEME, INGEST_DETAILS, isRefreshInterval, PROJECT_PERMISSIONS} from "#shared/types"
import {defaultSystemInstructions} from "#shared/utils/instructions"

// ---------- Validation helpers ----------

/** Turns a zod error into a short, human readable message. */
export function zodErrorMessage(error: z.ZodError): string {
    const issue = error.issues[0]
    if (!issue) return "Invalid request"
    const path = issue.path.length ? `${issue.path.join(".")}: ` : ""
    return `${path}${issue.message}`.slice(0, 300)
}

/** Reads and validates a JSON body, throwing a 400 with a readable message. */
export async function readZodBody<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.output<T>> {
    const body = await readBody(event).catch(() => undefined)
    const result = schema.safeParse(body ?? {})
    if (!result.success) throw createError({statusCode: 400, statusMessage: zodErrorMessage(result.error)})
    return result.data
}

export function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname
    } catch {
        return false
    }
}

const HOST_PATTERN = /^(\*\.)?(localhost|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)(:\d{1,5})?$/

/**
 * Normalizes an allowed embed domain. Accepts `example.com`, `*.example.com` and full origins such as
 * `https://x.example.com:8080` (path / query are dropped). Returns null when invalid.
 */
export function normalizeAllowedDomain(input: string): string | null {
    const value = input.trim().toLowerCase()
    if (!value) return null
    if (/^https?:\/\//.test(value)) {
        try {
            const url = new URL(value)
            if (!HOST_PATTERN.test(url.host)) return null
            return `${url.protocol}//${url.host}`
        } catch {
            return null
        }
    }
    const host = value.split(/[/?#]/)[0]!
    return HOST_PATTERN.test(host) ? host : null
}

const hexColor = z
    .string()
    .trim()
    .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "Colour must be a hex value like #a3ff7a")

const supportEmailSchema = z.union([z.literal(""), z.email("Support email must be a valid email address")])

const websiteSchema = z.string().trim().max(500).refine(isHttpUrl, "Website must be a valid http(s) URL")

const systemInstructionsSchema = z.string().max(20_000)

const modelSchema = z
    .string()
    .trim()
    .min(1, "Model is required")
    .max(200)
    .regex(/^[\w.:/@~-]+$/, "Invalid model id")

/** Image data URI stored as the project icon (capped around 300 KB raw). */
export const PROJECT_ICON_MAX_CHARS = 420_000
const iconSchema = z
    .string()
    .max(PROJECT_ICON_MAX_CHARS, "Icon image is too large")
    .regex(/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i, "Icon must be an image data URI")

export const projectCreateSchema = z.object({
    title: z.string().trim().min(1, "Title is required").max(120),
    website: websiteSchema,
    systemInstructions: systemInstructionsSchema.optional(),
    model: z.union([z.literal(""), modelSchema]).optional(),
    supportEmail: z.string().trim().toLowerCase().pipe(supportEmailSchema).optional(),
    /** Add the website as a crawled URL source (default true) */
    indexWebsite: z.boolean().optional()
})

/** Pages crawled by the website source created with a new project */
export const WEBSITE_SOURCE_MAX_PAGES = 25

export const themePatchSchema = z
    .object({
        mode: z.enum(["light", "dark"]),
        accent: hexColor,
        accent2: hexColor,
        highlight: hexColor,
        botName: z.string().trim().min(1, "Bot name is required").max(60),
        welcomeMessage: z.string().max(1000),
        placeholder: z.string().max(120),
        position: z.enum(["right", "left"])
    })
    .partial()

export const projectUpdateSchema = z
    .object({
        title: z.string().trim().min(1, "Title is required").max(120),
        website: websiteSchema,
        systemInstructions: systemInstructionsSchema,
        model: modelSchema,
        temperature: z.number().min(0).max(2),
        rateLimit: z.number().int().min(0).max(1000),
        supportEmail: z.string().trim().toLowerCase().pipe(supportEmailSchema),
        allowedDomains: z.array(z.string().max(300)).max(50, "At most 50 allowed domains"),
        /** Image data URI; empty string resets the icon to the two-letter mark */
        icon: z.union([z.literal(""), iconSchema]),
        refreshIntervalHours: z.number().refine(isRefreshInterval, "Manual only (0) or 1 to 336 hours"),
        ingestDetail: z.enum(INGEST_DETAILS),
        showCodeSources: z.boolean(),
        theme: themePatchSchema,
        enabled: z.boolean()
    })
    .partial()

export type ProjectCreateInput = z.output<typeof projectCreateSchema>
export type ProjectUpdateInput = z.output<typeof projectUpdateSchema>

// ---------- Create / update ----------

export function buildProject(input: ProjectCreateInput): Project {
    const config = useRuntimeConfig()
    const now = new Date()
    const project: Project = {
        _id: newId(),
        title: input.title,
        website: input.website,
        systemInstructions: input.systemInstructions?.trim() || defaultSystemInstructions(input.title, input.website),
        model: input.model || String(config.defaultChatModel),
        temperature: 0.3,
        rateLimit: 20,
        allowedDomains: [],
        refreshIntervalHours: DEFAULT_REFRESH_HOURS,
        showCodeSources: true,
        theme: {...DEFAULT_THEME, botName: input.title.slice(0, 60)},
        enabled: true,
        createdAt: now,
        updatedAt: now
    }
    if (input.supportEmail) project.supportEmail = input.supportEmail
    return project
}

/** Converts a validated patch into a Mongo update. Throws 400 on invalid allowed domains. */
export function buildProjectUpdate(project: Project, patch: ProjectUpdateInput): {$set: Partial<Project>; $unset: Record<string, "">} {
    const $set: Partial<Project> = {updatedAt: new Date()}
    const $unset: Record<string, ""> = {}
    const simple = ["title", "website", "systemInstructions", "model", "temperature", "rateLimit", "refreshIntervalHours", "ingestDetail", "showCodeSources", "enabled"] as const
    for (const key of simple) {
        if (patch[key] !== undefined) ($set as any)[key] = patch[key]
    }
    if (patch.supportEmail !== undefined) {
        if (patch.supportEmail) $set.supportEmail = patch.supportEmail
        else $unset.supportEmail = ""
    }
    if (patch.icon !== undefined) {
        if (patch.icon) $set.icon = patch.icon
        else $unset.icon = ""
    }
    if (patch.allowedDomains) {
        const normalized: string[] = []
        for (const raw of patch.allowedDomains) {
            if (!raw.trim()) continue
            const domain = normalizeAllowedDomain(raw)
            if (!domain) throw createError({statusCode: 400, statusMessage: `Invalid domain: ${raw.trim().slice(0, 100)}`})
            if (!normalized.includes(domain)) normalized.push(domain)
        }
        $set.allowedDomains = normalized
    }
    if (patch.theme) {
        const theme: ChatTheme = {...DEFAULT_THEME, ...project.theme}
        for (const [key, value] of Object.entries(patch.theme)) {
            if (value !== undefined) (theme as any)[key] = value
        }
        $set.theme = theme
    }
    return {$set, $unset}
}

// ---------- Summaries ----------

export interface ProjectStats {
    sources: number
    faqs: number
    chunks: number
    sessions7d: number
    openQuestions: number
}

async function countByProject(collection: {aggregate: (p: any[]) => {toArray: () => Promise<any[]>}}, match: Record<string, any>): Promise<Map<string, number>> {
    const rows = await collection.aggregate([{$match: match}, {$group: {_id: "$projectId", n: {$sum: 1}}}]).toArray()
    return new Map(rows.map((r: any) => [String(r._id), Number(r.n)]))
}

/** Projects visible to the user with permissions and quick stats. */
export async function listProjectSummaries(user: User) {
    const {projects, sources, faqs, chunks, sessions, questions} = await useCollections()
    const ids = accessibleProjectIds(user)
    const list = await projects
        .find(ids ? {_id: {$in: ids}} : {})
        .sort({createdAt: 1})
        .toArray()
    if (!list.length) return []
    const projectIds = list.map((p) => p._id)
    const inProjects = {projectId: {$in: projectIds}}
    const since = new Date(Date.now() - 7 * 86400_000)
    const [s, f, c, ss, q] = await Promise.all([
        countByProject(sources, inProjects),
        countByProject(faqs, inProjects),
        countByProject(chunks, inProjects),
        countByProject(sessions, {...inProjects, createdAt: {$gte: since}}),
        countByProject(questions, {...inProjects, status: "open"})
    ])
    return list.map((project) => ({
        ...project,
        permissions: projectPermissions(user, project._id) as ProjectPermission[],
        stats: {
            sources: s.get(project._id) ?? 0,
            faqs: f.get(project._id) ?? 0,
            chunks: c.get(project._id) ?? 0,
            sessions7d: ss.get(project._id) ?? 0,
            openQuestions: q.get(project._id) ?? 0
        } satisfies ProjectStats
    }))
}

// ---------- Delete ----------

/** Deletes a project and every document that belongs to it, and removes it from users' access lists. */
export async function deleteProjectCascade(projectId: string): Promise<void> {
    const c = await useCollections()
    const filter = {projectId}
    await Promise.all([
        c.chunks.deleteMany(filter),
        c.documents.deleteMany(filter),
        c.sources.deleteMany(filter),
        c.faqs.deleteMany(filter),
        c.messages.deleteMany(filter),
        c.sessions.deleteMany(filter),
        c.questions.deleteMany(filter),
        c.syncRuns.deleteMany(filter)
    ])
    await c.users.updateMany({"projects.projectId": projectId}, {$pull: {projects: {projectId}}})
    await c.projects.deleteOne({_id: projectId})
}

// ---------- Misc ----------

/** Mongo projection that drops session secrets. */
export const SESSION_SAFE_PROJECTION = {tokenHash: 0, ipHash: 0} as const

// ---------- User access ----------

export const projectAccessListSchema = z
    .array(
        z.object({
            projectId: z.string().min(1).max(64),
            permissions: z.array(z.enum(PROJECT_PERMISSIONS)).max(PROJECT_PERMISSIONS.length)
        })
    )
    .max(500)

/** Validates that every project exists; dedupes and drops entries without permissions. */
export async function normalizeProjectAccess(list: z.output<typeof projectAccessListSchema>): Promise<ProjectAccess[]> {
    const merged = new Map<string, Set<ProjectPermission>>()
    for (const entry of list) {
        const set = merged.get(entry.projectId) ?? new Set<ProjectPermission>()
        entry.permissions.forEach((p) => set.add(p))
        merged.set(entry.projectId, set)
    }
    const ids = [...merged.keys()]
    if (ids.length) {
        const {projects} = await useCollections()
        const found = await projects.find({_id: {$in: ids}}, {projection: {_id: 1}}).toArray()
        const existing = new Set(found.map((p) => p._id))
        const missing = ids.find((id) => !existing.has(id))
        if (missing) throw createError({statusCode: 400, statusMessage: `Unknown project: ${missing}`})
    }
    return [...merged.entries()].filter(([, perms]) => perms.size > 0).map(([projectId, perms]) => ({projectId, permissions: PROJECT_PERMISSIONS.filter((p) => perms.has(p))}))
}

/** Number of enabled admins other than the given user. */
export async function countOtherActiveAdmins(userId: string): Promise<number> {
    const {users} = await useCollections()
    return users.countDocuments({_id: {$ne: userId}, role: "admin", disabled: {$ne: true}})
}
