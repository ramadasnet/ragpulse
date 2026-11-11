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

/** Loads the chat session from the `sid` router param and verifies the `x-session-token` header. */
export async function requireChatSession(event: H3Event, project: Project): Promise<ChatSession> {
    const sid = getRouterParam(event, "sid") || ""
    const token = getRequestHeader(event, "x-session-token") || ""
    if (!ID_RE.test(sid) || !token || token.length > 200) throw createError({statusCode: 401, statusMessage: "Invalid session"})
    const {sessions} = await useCollections()
    const session = await sessions.findOne({_id: sid, projectId: project._id})
    if (!session || !safeEqualHex(sha256(token), session.tokenHash)) {
        throw createError({statusCode: 401, statusMessage: "Invalid session"})
    }
    return session
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
        createdAt: session.createdAt
    }
}

export function publicChatMessage(message: ChatMessage) {
    return {
        _id: message._id,
        role: message.role,
        content: message.content,
        sources: message.sources?.length ? message.sources : undefined,
        escalated: message.escalated || undefined,
        createdAt: message.createdAt
    }
}
