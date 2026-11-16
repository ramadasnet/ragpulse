import {z} from "zod"
import type {ChatMessage, ChatSession} from "#shared/types"

const schema = z.object({
    name: z.string().trim().max(80).optional(),
    email: z.union([z.literal(""), z.email().max(200)]).optional(),
    question: z.string().trim().max(CHAT_MAX_MESSAGE_CHARS).optional()
})

/**
 * Visitor asks the team directly or shares their contact details:
 * - `{name, email, question}` (message limit reached / contact form) → records a question
 * - `{name, email}` only (after an escalated answer) → attaches the details to the session and its open questions
 */
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-escalate", 10, 3600_000)
    const session = await requireChatSession(event, project)

    const parsed = schema.safeParse(await readLimitedJson(event, 12_288))
    if (!parsed.success) throw createError({statusCode: 400, statusMessage: parsed.error.issues[0]?.message || "Invalid request"})
    const name = parsed.data.name?.replace(/[\r\n\t]+/g, " ").trim() || undefined
    const email = parsed.data.email?.toLowerCase() || undefined
    const text = parsed.data.question || ""
    if (!name && !email && !text) throw createError({statusCode: 400, statusMessage: "Please enter your details or a question"})

    const {sessions, questions, messages} = await useCollections()
    const details: Partial<Pick<ChatSession, "visitorName" | "visitorEmail">> = {}
    if (name && name !== session.visitorName) details.visitorName = name
    if (email && email !== session.visitorEmail) details.visitorEmail = email
    if (Object.keys(details).length) {
        const now = new Date()
        await sessions.updateOne({_id: session._id}, {$set: details})
        // Backfill open questions that predate the visitor sharing their details
        if (details.visitorName)
            await questions.updateMany({sessionId: session._id, status: "open", $or: [{visitorName: {$exists: false}}, {visitorName: {$type: "null"}}, {visitorName: ""}]}, {$set: {visitorName: details.visitorName, updatedAt: now}})
        if (details.visitorEmail)
            await questions.updateMany({sessionId: session._id, status: "open", $or: [{visitorEmail: {$exists: false}}, {visitorEmail: {$type: "null"}}, {visitorEmail: ""}]}, {$set: {visitorEmail: details.visitorEmail, updatedAt: now}})
        Object.assign(session, details)
    }

    let message: ChatMessage | undefined
    let questionId: string | undefined
    if (text) {
        const now = new Date()
        message = {_id: newId(), projectId: project._id, sessionId: session._id, role: "user", content: text, createdAt: now}
        await messages.insertOne(message)
        await sessions.updateOne({_id: session._id}, {$inc: {messageCount: 1}, $set: {lastMessageAt: now}, $unset: {finishedAt: "", finishedBy: ""}})
        const question = await createQuestion({
            project,
            session,
            question: text,
            reason: session.limitReached ? "rate_limit" : "user_request",
            messageId: message._id,
            visitorEmail: email
        })
        questionId = question._id
    }

    return {
        ok: true,
        questionId,
        message: message ? publicChatMessage(message, project) : undefined,
        session: publicChatSession(session)
    }
})
