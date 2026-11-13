import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import type {ChatMessage, ChatSession} from "#shared/types"
import {type McpContext, McpToolError, mcpAuthorName, mcpOk, mcpParseDate, mcpProject, mcpSafely} from "./context"
import {mcpProjectIdArg} from "./projects"

export function mcpSessionView(s: ChatSession) {
    return {
        id: s._id,
        projectId: s.projectId,
        visitorName: s.visitorName,
        visitorEmail: s.visitorEmail,
        origin: s.origin,
        messageCount: s.messageCount,
        userMessageCount: s.userMessageCount,
        unansweredCount: s.unansweredCount,
        limitReached: s.limitReached,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt
    }
}

export function mcpMessageView(m: ChatMessage, maxLength?: number) {
    return {
        id: m._id,
        role: m.role,
        content: maxLength && m.content.length > maxLength ? `${m.content.slice(0, maxLength - 1)}…` : m.content,
        createdAt: m.createdAt,
        author: m.author ? {name: m.author.name, via: m.author.via} : undefined,
        escalated: m.escalated || undefined,
        questionId: m.questionId,
        sources: m.sources?.length ? m.sources : undefined
    }
}

const sessionProjection = {tokenHash: 0, ipHash: 0, userAgent: 0} as const

/** Loads a session and checks the permission on its project (same message for "missing" and "forbidden"). */
async function sessionFor(ctx: McpContext, sessionId: string, permission: "sessions:read" | "questions:reply") {
    const {sessions} = await useCollections()
    const session = await sessions.findOne({_id: sessionId}, {projection: sessionProjection})
    if (!session || !canAccessProject(ctx.user, session.projectId)) throw new McpToolError(`Session "${sessionId}" not found.`)
    await mcpProject(ctx, session.projectId, permission)
    return session
}

export function registerMcpSessionTools(server: McpServer, ctx: McpContext) {
    server.registerTool(
        "list_sessions",
        {
            title: "List chat sessions",
            description: "Lists recent chat sessions (conversations) of a project, newest activity first. Requires sessions:read.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                limit: z.number().int().min(1).max(100).default(20).describe("Max sessions to return (1-100, default 20)"),
                since: z.string().optional().describe("Only sessions with activity since this ISO 8601 date/time"),
                only_unanswered: z.boolean().default(false).describe("Only sessions that still have open (unanswered) questions")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, limit, since, only_unanswered}) =>
            mcpSafely(async () => {
                const project = await mcpProject(ctx, project_id, "sessions:read")
                const sinceDate = mcpParseDate(since, "since")
                const {sessions} = await useCollections()
                const filter: Record<string, any> = {projectId: project._id}
                if (sinceDate) filter.lastMessageAt = {$gte: sinceDate}
                if (only_unanswered) filter.unansweredCount = {$gt: 0}
                const list = await sessions.find(filter, {projection: sessionProjection}).sort({lastMessageAt: -1}).limit(limit).toArray()
                const items = list.map(mcpSessionView)
                const summary = items.length
                    ? `${items.length} session(s) in ${project.title}:\n${items.map((s) => `- ${s.visitorName} (id: ${s.id}) — ${s.messageCount} msg, ${s.unansweredCount} unanswered, last ${new Date(s.lastMessageAt).toISOString()}`).join("\n")}`
                    : `No matching sessions in ${project.title}.`
                return mcpOk(summary, {sessions: items})
            })
    )

    server.registerTool(
        "get_session",
        {
            title: "Get chat session",
            description: "Returns a chat session with its messages (oldest first) and related questions. Requires sessions:read on its project.",
            inputSchema: {
                session_id: z.string().min(1).describe("Chat session id"),
                message_limit: z.number().int().min(1).max(500).default(100).describe("Max number of most recent messages to return (default 100)")
            },
            annotations: {readOnlyHint: true}
        },
        ({session_id, message_limit}) =>
            mcpSafely(async () => {
                const session = await sessionFor(ctx, session_id, "sessions:read")
                const {messages, questions} = await useCollections()
                const [recent, related] = await Promise.all([messages.find({sessionId: session._id}).sort({createdAt: -1}).limit(message_limit).toArray(), questions.find({sessionId: session._id}).sort({createdAt: 1}).toArray()])
                const items = recent.reverse().map((m) => mcpMessageView(m))
                const data = {
                    session: mcpSessionView(session),
                    messages: items,
                    questions: related.map((q) => ({id: q._id, question: q.question, status: q.status, reason: q.reason, answer: q.answer, createdAt: q.createdAt}))
                }
                const transcript = items.map((m) => `[${m.role}${m.author ? `: ${m.author.name}` : ""}] ${m.content}`).join("\n")
                return mcpOk(`Session ${session._id} with ${session.visitorName} — ${session.messageCount} message(s), ${session.unansweredCount} unanswered.\n\n${transcript}`, data)
            })
    )

    server.registerTool(
        "send_session_message",
        {
            title: "Send message to a chat session",
            description:
                "Posts a human/agent message (markdown) into a visitor's chat session, e.g. a proactive follow-up. The visitor sees it in the chat; it is NOT emailed. To answer an escalated question (with email notification), use reply_to_question. Requires questions:reply.",
            inputSchema: {
                session_id: z.string().min(1).describe("Chat session id"),
                content: z.string().trim().min(1).max(8000).describe("Message text (markdown)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true}
        },
        ({session_id, content}) =>
            mcpSafely(async () => {
                const session = await sessionFor(ctx, session_id, "questions:reply")
                const {messages, sessions} = await useCollections()
                const now = new Date()
                const message: ChatMessage = {
                    _id: newId(),
                    projectId: session.projectId,
                    sessionId: session._id,
                    role: "agent",
                    content,
                    author: {userId: ctx.user._id, name: mcpAuthorName(ctx), via: "mcp"},
                    createdAt: now
                }
                await messages.insertOne(message)
                await sessions.updateOne({_id: session._id}, {$inc: {messageCount: 1}, $set: {lastMessageAt: now}})
                return mcpOk(`Message posted to session ${session._id} (${session.visitorName}).`, {message: mcpMessageView(message)})
            })
    )
}
