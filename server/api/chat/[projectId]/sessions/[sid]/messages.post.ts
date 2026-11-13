import {z} from "zod"
import type {ChatMessage} from "#shared/types"
import logger from "../../../../../utils/logger"

const schema = z.object({
    content: z.string().trim().min(1, "Message is empty").max(CHAT_MAX_MESSAGE_CHARS, `Messages are limited to ${CHAT_MAX_MESSAGE_CHARS} characters`)
})

/** Sessions with a reply currently being generated (one stream per session at a time). */
const activeSessions = new Set<string>()

/**
 * Sends a visitor message and streams the answer as Server-Sent Events:
 * `meta` {userMessageId} · `delta` {text} · `done` {message} · `escalated` {questionId, message, needsEmail}
 * · `limit` {message, hasSupport} · `error` {message}
 */
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-message", 30, 600_000)
    const session = await requireChatSession(event, project)

    const parsed = schema.safeParse(await readLimitedJson(event, 12_288))
    if (!parsed.success) throw createError({statusCode: 400, statusMessage: parsed.error.issues[0]?.message || "Invalid message"})
    const content = parsed.data.content

    if (activeSessions.has(session._id)) {
        throw createError({statusCode: 409, statusMessage: "Please wait for the current reply to finish"})
    }

    const startedAt = Date.now()
    const encoder = new TextEncoder()
    let closed = false
    let controller!: ReadableStreamDefaultController<Uint8Array>

    const write = (chunk: string) => {
        if (closed) return
        try {
            controller.enqueue(encoder.encode(chunk))
        } catch {
            closed = true
        }
    }
    const send = (name: string, data: unknown) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    const finish = () => {
        if (closed) return
        closed = true
        try {
            controller.close()
        } catch {}
    }

    async function run() {
        const {messages, sessions} = await useCollections()

        if (session.limitReached || (project.rateLimit > 0 && session.userMessageCount >= project.rateLimit)) {
            if (!session.limitReached) await sessions.updateOne({_id: session._id}, {$set: {limitReached: true}})
            send("limit", {
                message: "You've reached the message limit for this conversation. Send your question to our team and we'll get back to you.",
                hasSupport: !!project.supportEmail
            })
            return
        }

        if (!useRuntimeConfig(event).openrouterApiKey) {
            send("error", {message: "The assistant is not configured yet (missing OpenRouter API key). Please try again later."})
            return
        }

        const now = new Date()
        const userMessage: ChatMessage = {_id: newId(), projectId: project._id, sessionId: session._id, role: "user", content, createdAt: now}
        await messages.insertOne(userMessage)
        await sessions.updateOne({_id: session._id}, {$inc: {userMessageCount: 1, messageCount: 1}, $set: {lastMessageAt: now}})
        session.userMessageCount++
        send("meta", {userMessageId: userMessage._id})

        try {
            for await (const ev of generateAnswer({project, session, userMessage, startedAt})) {
                if (ev.type === "delta") send("delta", {text: ev.text})
                else if (ev.type === "done") send("done", {message: publicChatMessage(ev.message)})
                else send("escalated", {questionId: ev.question._id, message: publicChatMessage(ev.message), needsEmail: !session.visitorEmail})
            }
        } catch (err: any) {
            logger.error("Chat.messages", `Answer failed for session ${session._id}`, err)
            send("error", {message: "Sorry, something went wrong while generating the answer. Please try again."})
        }
    }

    activeSessions.add(session._id)
    const stream = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c
            // Padding comment so proxies flush the response headers right away
            write(`: ${" ".repeat(2048)}\n\n`)
            // Keep-alive comments: Bun.serve closes connections idle for 10s by default
            const heartbeat = setInterval(() => write(": ping\n\n"), 5000)
            run()
                .catch((err: any) => {
                    logger.error("Chat.messages", `Stream failed for session ${session._id}`, err)
                    send("error", {message: "Sorry, something went wrong. Please try again."})
                })
                .finally(() => {
                    clearInterval(heartbeat)
                    activeSessions.delete(session._id)
                    finish()
                })
        },
        // Client went away: keep generating so the answer is stored and shown on reload
        cancel() {
            closed = true
        }
    })

    setResponseStatus(event, 200)
    setResponseHeaders(event, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        "X-Accel-Buffering": "no"
    })
    return stream
})
