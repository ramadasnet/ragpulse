import type {H3Event} from "h3"
import {timingSafeEqual} from "node:crypto"
import type {ChatMessage, ChatSession, Project} from "#shared/types"
import {DEFAULT_THEME} from "#shared/types"

// Helpers shared by the public chat API (/api/chat/**), the chat page middleware and embed.js.

const PROJECT_TTL_MS = 30_000
const projectCache = new Map<string, {at: number; project: Project | null}>()
const ID_RE = /^[\w-]{1,64}$/

export const CHAT_MAX_MESSAGE_CHARS = 2000

/** Project lookup with a short in-memory cache (also caches misses). Returns disabled projects too. */
export async function getChatProject(projectId: string): Promise<Project | null> {
    if (!ID_RE.test(projectId)) return null
    const cached = projectCache.get(projectId)
    if (cached && Date.now() - cached.at < PROJECT_TTL_MS) return cached.project
    const {projects} = await useCollections()
    const project = await projects.findOne({_id: projectId})
    if (projectCache.size > 5000) projectCache.clear()
    projectCache.set(projectId, {at: Date.now(), project})
    return project
}

/** Drops a project from the public cache (call after updating a project to apply changes immediately). */
export function invalidateChatProject(projectId: string) {
    projectCache.delete(projectId)
}

/** The chat instance's own origins (request host and configured public chat URL). */
export function selfOrigins(event: H3Event): string[] {
    const origins = [getRequestURL(event, {xForwardedHost: true, xForwardedProto: true}).origin]
    const chatOrigin = urlOrigin(useRuntimeConfig(event).public.chatUrl)
    if (chatOrigin) origins.push(chatOrigin)
    return origins
}

export function isSelfOrigin(event: H3Event, origin: string): boolean {
    if (selfOrigins(event).includes(origin)) return true
    try {
        return new URL(origin).host === getRequestHost(event, {xForwardedHost: true})
    } catch {
        return false
    }
}

/**
 * Loads the enabled project for `/api/chat/:projectId/**` and rejects cross-origin requests
 * coming from origins that are neither this app nor an allowed embedding host.
 */
export async function requireChatProject(event: H3Event, opts: {checkOrigin?: boolean} = {}): Promise<Project> {
    const projectId = getRouterParam(event, "projectId") || ""
    const project = await getChatProject(projectId)
    if (!project || !project.enabled) throw createError({statusCode: 404, statusMessage: "Chat not found"})
    if (opts.checkOrigin !== false) {
        const origin = getRequestHeader(event, "origin")
        if (origin && !isSelfOrigin(event, origin) && !isOriginAllowed(project, origin)) {
            throw createError({statusCode: 403, statusMessage: "Origin not allowed"})
        }
    }
    return project
}

function safeEqualHex(a: string, b: string): boolean {
    const ba = Buffer.from(a, "hex")
    const bb = Buffer.from(b, "hex")
    return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
}

/** Loads the chat session from the `sid` router param and verifies the `x-session-token` header. Ended sessions are rejected unless `allowEnded`. */
export async function requireChatSession(event: H3Event, project: Project, opts: {allowEnded?: boolean} = {}): Promise<ChatSession> {
    const sid = getRouterParam(event, "sid") || ""
    const token = getRequestHeader(event, "x-session-token") || ""
    if (!ID_RE.test(sid) || !token || token.length > 200) throw createError({statusCode: 401, statusMessage: "Invalid session"})
    const {sessions} = await useCollections()
    const session = await sessions.findOne({_id: sid, projectId: project._id})
    if (!session || !safeEqualHex(sha256(token), session.tokenHash)) {
        throw createError({statusCode: 401, statusMessage: "Invalid session"})
    }
    if ((await sessionEnded(session)) && !opts.allowEnded) throw createError({statusCode: 401, statusMessage: "This conversation has ended"})
    return session
}

/**
 * Whether the session ended: by the visitor, or after `chatAutoCloseDays` without messages.
 * Flags inactive sessions right away (the scheduler only closes them hourly) and updates `session`.
 */
export async function sessionEnded(session: Pick<ChatSession, "_id" | "endedAt" | "endReason" | "lastMessageAt">): Promise<boolean> {
    if (session.endedAt) return true
    const days = (await getAppSettings()).chatAutoCloseDays
    if (!days || new Date(session.lastMessageAt).getTime() >= Date.now() - days * 24 * 3600 * 1000) return false
    const {sessions} = await useCollections()
    session.endedAt = new Date()
    session.endReason = "inactive"
    await sessions.updateOne({_id: session._id, endedAt: {$exists: false}}, {$set: {endedAt: session.endedAt, endReason: session.endReason}})
    return true
}

/** Rejects team messages (admin panel or MCP) into an ended conversation. */
export async function assertSessionNotEnded(session: Pick<ChatSession, "_id" | "endedAt" | "endReason" | "lastMessageAt">): Promise<void> {
    if (!(await sessionEnded(session))) return
    const why = session.endReason === "inactive" ? "was closed after a period without messages" : "was ended by the visitor"
    throw createError({statusCode: 409, statusMessage: `This conversation ${why}, it can't receive new messages`})
}

/**
 * Commits a team message only while the conversation is open: the conditional session update is the atomic
 * commit point, so a message can never stay posted after the session's `endedAt` was set. The inserted
 * message is rolled back when the visitor ended the conversation in the meantime.
 */
export async function commitSessionMessage(message: ChatMessage): Promise<void> {
    const {messages, sessions} = await useCollections()
    await messages.insertOne(message)
    const res = await sessions.updateOne({_id: message.sessionId, endedAt: {$exists: false}}, {$inc: {messageCount: 1}, $set: {lastMessageAt: message.createdAt}, $unset: {finishedAt: "", finishedBy: ""}})
    if (res.matchedCount) return
    await messages.deleteOne({_id: message._id})
    throw createError({statusCode: 409, statusMessage: "This conversation was ended by the visitor, it can't receive new messages"})
}

/** Reads and parses a JSON body, rejecting bodies larger than `maxBytes`. */
export async function readLimitedJson(event: H3Event, maxBytes = 16_384): Promise<unknown> {
    const declared = Number(getRequestHeader(event, "content-length") || 0)
    if (declared > maxBytes) throw createError({statusCode: 413, statusMessage: "Request body too large"})
    const raw = await readRawBody(event, "utf8")
    if (!raw) return {}
    if (Buffer.byteLength(raw) > maxBytes) throw createError({statusCode: 413, statusMessage: "Request body too large"})
    try {
        return JSON.parse(raw)
    } catch {
        throw createError({statusCode: 400, statusMessage: "Invalid JSON body"})
    }
}

/** Privacy friendly IP hash: rotates daily. */
export function hashIp(ip: string): string {
    const secret = process.env.NUXT_APP_SECRET || process.env.NUXT_SESSION_PASSWORD || "ragpulse"
    return sha256(`${ip}|${new Date().toISOString().slice(0, 10)}|${secret}`).slice(0, 32)
}

export function publicChatConfig(project: Project) {
    return {
        projectId: project._id,
        title: project.title,
        website: project.website,
        theme: {...DEFAULT_THEME, ...project.theme, botName: project.theme?.botName || project.title},
        /** Project icon URL (versioned so caches refresh when the project changes) */
        icon: project.icon ? `/api/chat/${project._id}/icon?v=${new Date(project.updatedAt).getTime()}` : undefined,
        rateLimit: project.rateLimit,
        hasSupport: !!project.supportEmail,
        allowedHosts: allowedHostPatterns(project)
    }
}

export type PublicChatConfig = ReturnType<typeof publicChatConfig>

export function publicChatSession(session: ChatSession) {
    return {
        _id: session._id,
        visitorName: session.visitorName,
        visitorEmail: session.visitorEmail,
        userMessageCount: session.userMessageCount,
        limitReached: session.limitReached,
        /** A human from the team is replying: the assistant does not answer (header shows "human" instead of "agent") */
        humanHandling: !!session.humanHandledAt,
        /** The conversation ended (by the visitor, or `inactive` after a period without messages): it is read-only */
        endedAt: session.endedAt,
        endReason: session.endReason,
        createdAt: session.createdAt
    }
}

/** Message as shown to the visitor. Source code references are dropped when the project hides them. */
export function publicChatMessage(message: ChatMessage, project: Pick<Project, "showCodeSources">) {
    // Sources stored before the `kind` field existed count as documents
    const all = message.sources?.map((s) => ({...s, kind: s.kind === "code" ? ("code" as const) : ("docs" as const)}))
    const sources = project.showCodeSources === false ? all?.filter((s) => s.kind !== "code") : all
    return {
        _id: message._id,
        role: message.role,
        content: message.content,
        sources: sources?.length ? sources : undefined,
        escalated: message.escalated || undefined,
        emailFallback: message.emailFallback || undefined,
        createdAt: message.createdAt
    }
}
