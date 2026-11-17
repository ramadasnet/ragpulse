import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import type {ChatMessage, ChatSession} from "#shared/types"
import {type McpContext, McpToolError, mcpAuthorName, mcpEscapeRegex, mcpJson, mcpOk, mcpParseDate, mcpProject, mcpSafely} from "./context"
import {mcpProjectIdArg} from "./projects"

/** Computes effective end state of a session, accounting for lazy inactivity auto-close. */
export function effectiveSessionEnd(s: Pick<ChatSession, "endedAt" | "endReason" | "lastMessageAt">, autoCloseDays?: number): {endedAt?: Date; endReason?: "visitor" | "inactive"} {
    if (s.endedAt) return {endedAt: s.endedAt, endReason: s.endReason ?? "visitor"}
    if (autoCloseDays && new Date(s.lastMessageAt).getTime() < Date.now() - autoCloseDays * 86400_000) {
        return {endedAt: new Date(new Date(s.lastMessageAt).getTime() + autoCloseDays * 86400_000), endReason: "inactive"}
    }
    return {}
}

export function mcpSessionView(s: ChatSession, autoCloseDays?: number) {
    const end = effectiveSessionEnd(s, autoCloseDays)
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
        finishedAt: s.finishedAt,
        finishedBy: s.finishedBy ? {name: s.finishedBy.name, via: s.finishedBy.via} : undefined,
        endedAt: end.endedAt,
        endReason: end.endReason,
        learnedFaqId: s.learnedFaqId,
        humanHandledAt: s.humanHandledAt,
        humanHandledBy: s.humanHandledAt ? (s.humanHandledBy?.name ?? "Support team") : undefined,
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
            description: "Lists recent chat sessions (conversations) of a project, newest activity first, with optional visitor search and cursor pagination. Requires sessions:read.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                limit: z.number().int().min(1).max(100).default(20).describe("Max sessions to return (1-100, default 20)"),
                query: z.string().trim().max(100).optional().describe("Case-insensitive filter on visitor name or email"),
                since: z.string().optional().describe("Only sessions with activity at or after this ISO 8601 date/time"),
                before: z.string().optional().describe("Pagination cursor: pass the nextBefore value of the previous page (or an ISO 8601 date/time to return only sessions with activity strictly before it)"),
                only_unanswered: z.boolean().default(false).describe("Only sessions that still have open (unanswered) questions")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, limit, query, since, before, only_unanswered}) =>
            mcpSafely(ctx, "list_sessions", async () => {
                const project = await mcpProject(ctx, project_id, "sessions:read")
                const sinceDate = mcpParseDate(since, "since")
                const [beforeRaw, beforeId] = before?.split("|") ?? []
                const beforeDate = mcpParseDate(beforeRaw, "before")
                const {sessions} = await useCollections()
                const filter: Record<string, any> = {projectId: project._id}
                const and: Record<string, any>[] = []
                if (sinceDate) filter.lastMessageAt = {$gte: sinceDate}
                if (beforeDate) {
                    // Ties on lastMessageAt are broken by _id so no session is skipped between pages
                    if (beforeId) and.push({$or: [{lastMessageAt: {$lt: beforeDate}}, {lastMessageAt: beforeDate, _id: {$lt: beforeId}}]})
                    else and.push({lastMessageAt: {$lt: beforeDate}})
                }
                if (only_unanswered) filter.unansweredCount = {$gt: 0}
                if (query) {
                    const re = {$regex: mcpEscapeRegex(query), $options: "i"}
                    and.push({$or: [{visitorName: re}, {visitorEmail: re}]})
                }
                if (and.length) filter.$and = and
                const [list, settings] = await Promise.all([sessions.find(filter, {projection: sessionProjection}).sort({lastMessageAt: -1, _id: -1}).limit(limit).toArray(), getAppSettings()])
                const items = list.map((s) => mcpSessionView(s, settings.chatAutoCloseDays))
                const last = list[list.length - 1]
                const nextBefore = list.length === limit && last ? `${new Date(last.lastMessageAt).toISOString()}|${last._id}` : undefined
                const summary = items.length
                    ? `${items.length} session(s) in ${project.title}:\n${items.map((s) => `- ${s.visitorName} (id: ${s.id}) - ${s.messageCount} msg, ${s.unansweredCount} unanswered, last ${new Date(s.lastMessageAt).toISOString()}`).join("\n")}`
                    : `No matching sessions in ${project.title}.`
                return mcpOk(summary, {sessions: items, ...(nextBefore ? {nextBefore} : {})})
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
            mcpSafely(ctx, "get_session", async () => {
                const session = await sessionFor(ctx, session_id, "sessions:read")
                await sessionEnded(session)
                const {messages, questions} = await useCollections()
                const [recent, related] = await Promise.all([messages.find({sessionId: session._id}).sort({createdAt: -1}).limit(message_limit).toArray(), questions.find({sessionId: session._id}).sort({createdAt: 1}).toArray()])
                const items = recent.reverse().map((m) => mcpMessageView(m))
                const truncated = session.messageCount > items.length
                const view = mcpSessionView(session)
                const data = {
                    session: view,
                    messages: items,
                    truncated,
                    questions: related.map((q) => ({id: q._id, question: q.question, status: q.status, reason: q.reason, answer: q.answer, createdAt: q.createdAt}))
                }
                const countNote = truncated ? `${session.messageCount} message(s) (showing latest ${items.length})` : `${session.messageCount} message(s)`
                const flags = [view.endedAt ? `ended (${view.endReason})` : "", view.humanHandledBy ? `human handling by ${view.humanHandledBy}` : ""].filter(Boolean)
                const header = `Session ${session._id} with ${session.visitorName}${session.visitorEmail ? ` <${session.visitorEmail}>` : ""} - ${countNote}, ${session.unansweredCount} unanswered${flags.length ? `, ${flags.join(", ")}` : ""}.`
                const questionLines = related.length ? `\n\nQuestions:\n${related.map((q) => `- [${q.status}] (id: ${q._id}, ${q.reason}) ${q.question}`).join("\n")}` : ""
                const transcript = items.map((m) => `[${m.role}${m.author ? `: ${m.author.name}` : ""}] ${m.content}`).join("\n")
                // Transcript and questions are already rendered as readable text; avoid duplicating them as JSON inside `content`
                return {content: [{type: "text", text: `${header}${questionLines}\n\n${transcript}`}], structuredContent: mcpJson(data)}
            })
    )

    server.registerTool(
        "send_session_message",
        {
            title: "Send message to a chat session",
            description:
                "Posts a human/agent message (markdown) into a visitor's chat session, e.g. a proactive follow-up. The visitor sees it in the chat; it is NOT emailed. Fails when the conversation ended (`endedAt`: the visitor started a new one, or it was closed after the configured days without messages). To answer an escalated question (with email notification), use reply_to_question. Requires questions:reply.",
            inputSchema: {
                session_id: z.string().min(1).describe("Chat session id"),
                content: z.string().trim().min(1).max(8000).describe("Message text (markdown)"),
                claim_handling: z.boolean().default(false).describe("Pause the AI assistant on this session while an escalated question remains open (default false)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true}
        },
        ({session_id, content, claim_handling}) =>
            mcpSafely(ctx, "send_session_message", async () => {
                const session = await sessionFor(ctx, session_id, "questions:reply")
                await assertSessionNotEnded(session)
                const author = {userId: ctx.user._id, name: mcpAuthorName(ctx), via: "mcp" as const}
                const message: ChatMessage = {
                    _id: newId(),
                    projectId: session.projectId,
                    sessionId: session._id,
                    role: "agent",
                    content,
                    author,
                    createdAt: new Date()
                }
                await commitSessionMessage(message)
                if (claim_handling) await claimHumanHandling(session._id, author)
                return mcpOk(`Message posted to session ${session._id} (${session.visitorName}).`, {message: mcpMessageView(message)})
            })
    )

    server.registerTool(
        "finish_session",
        {
            title: "Finish chat session",
            description:
                "Flags a chat session as finished (`finished: false` reopens it). On finish, conversations with human/agent replies are summarized into a new FAQ entry, with personal data stripped, so the assistant learns the answer. Sessions without human replies just get marked. Requires questions:reply.",
            inputSchema: {
                session_id: z.string().min(1).describe("Chat session id"),
                finished: z.boolean().default(true).describe("true marks the session finished, false reopens it")
            },
            annotations: {readOnlyHint: false, destructiveHint: false}
        },
        ({session_id, finished}) =>
            mcpSafely(ctx, "finish_session", async () => {
                const session = await sessionFor(ctx, session_id, "questions:reply")
                const {session: next, learned} = await finishSession({session, finished, author: {userId: ctx.user._id, name: mcpAuthorName(ctx), via: "mcp"}})
                let summary = finished ? `Session ${session._id} marked finished.` : `Session ${session._id} reopened.`
                if (learned?.faq) summary += ` Learned a new FAQ entry: "${learned.faq.question}" (id: ${learned.faq._id}).`
                else if (finished && learned?.skipped) summary += ` No FAQ learned: ${learned.skipped}.`
                if (learned?.indexError) summary += ` Warning: ${learned.indexError}`
                return mcpOk(summary, {
                    session: mcpSessionView(next),
                    learnedFaq: learned?.faq ? {id: learned.faq._id, question: learned.faq.question, answer: learned.faq.answer} : undefined,
                    skipped: learned?.skipped,
                    indexError: learned?.indexError
                })
            })
    )
}
