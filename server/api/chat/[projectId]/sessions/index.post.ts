import {z} from "zod"
import type {ChatSession} from "#shared/types"

const schema = z.object({
    name: z.string().trim().max(80).optional(),
    email: z.union([z.literal(""), z.email().max(200)]).optional(),
    parentOrigin: z.string().max(300).optional()
})

// Starts a chat session for a visitor (anonymous until they share their details on escalation).
// The plain token is only returned here.
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-session", 20, 3600_000)

    const parsed = schema.safeParse(await readLimitedJson(event, 4096))
    if (!parsed.success) throw createError({statusCode: 400, statusMessage: parsed.error.issues[0]?.message || "Invalid request"})
    const {name, email} = parsed.data

    let origin: string | undefined
    if (parsed.data.parentOrigin) {
        try {
            origin = new URL(parsed.data.parentOrigin).origin
        } catch {
            throw createError({statusCode: 400, statusMessage: "Invalid parent origin"})
        }
        if (!isSelfOrigin(event, origin) && !isOriginAllowed(project, origin)) {
            throw createError({statusCode: 403, statusMessage: "This site is not allowed to embed the chat"})
        }
    }

    const token = randomToken()
    const now = new Date()
    const session: ChatSession = {
        _id: newId(),
        projectId: project._id,
        visitorName: (name || "").replace(/[\r\n\t]+/g, " "),
        visitorEmail: email ? email.toLowerCase() : undefined,
        tokenHash: sha256(token),
        ipHash: hashIp(chatClientIp(event)),
        userAgent: getRequestHeader(event, "user-agent")?.slice(0, 300),
        origin,
        userMessageCount: 0,
        messageCount: 0,
        unansweredCount: 0,
        limitReached: false,
        createdAt: now,
        lastMessageAt: now
    }
    if (!session.visitorEmail) delete session.visitorEmail
    if (!session.origin) delete session.origin
    const {sessions} = await useCollections()
    await sessions.insertOne(session)
    setResponseHeader(event, "Cache-Control", "no-store")
    return {sessionId: session._id, token, session: publicChatSession(session)}
})
