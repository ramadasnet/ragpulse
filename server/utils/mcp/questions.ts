import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import type {ChatMessage, Question} from "#shared/types"
import {type McpContext, McpToolError, mcpAuthorName, mcpOk, mcpProject, mcpProjectIdsWith, mcpSafely} from "./context"
import {effectiveSessionEnd, mcpMessageView} from "./sessions"

const CONTEXT_MESSAGES = 8
const CONTEXT_MESSAGE_CHARS = 500

async function questionFor(ctx: McpContext, questionId: string): Promise<Question> {
    const {questions} = await useCollections()
    const question = await questions.findOne({_id: questionId})
    if (!question || !canAccessProject(ctx.user, question.projectId)) throw new McpToolError(`Question "${questionId}" not found.`)
    await mcpProject(ctx, question.projectId, "questions:reply")
    return question
}

export function registerMcpQuestionTools(server: McpServer, ctx: McpContext) {
    server.registerTool(
        "list_unanswered_questions",
        {
            title: "List escalated questions",
            description:
                "Lists visitor questions the chat assistant could not answer (escalations), newest first, each with recent conversation context and human-handling state. Without project_id, covers every project where you have questions:reply.",
            inputSchema: {
                project_id: z.string().min(1).optional().describe("Project id; omit to list across all projects you can reply in"),
                status: z.enum(["open", "answered", "dismissed", "all"]).default("open").describe('Question status filter (default "open")'),
                limit: z.number().int().min(1).max(200).default(50).describe("Max questions to return (1-200, default 50)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, status, limit}) =>
            mcpSafely(ctx, "list_unanswered_questions", async () => {
                const {questions, projects, sessions} = await useCollections()
                const filter: Record<string, any> = {}
                if (project_id) {
                    await mcpProject(ctx, project_id, "questions:reply")
                    filter.projectId = project_id
                } else {
                    const ids = mcpProjectIdsWith(ctx.user, "questions:reply")
                    if (ids && !ids.length) throw new McpToolError("You do not have the questions:reply permission on any project.")
                    if (ids) filter.projectId = {$in: ids}
                }
                if (status !== "all") filter.status = status

                const [list, total, settings] = await Promise.all([questions.find(filter).sort({createdAt: -1}).limit(limit).toArray(), questions.countDocuments(filter), getAppSettings()])
                if (!list.length) return mcpOk(`No ${status === "all" ? "" : `${status} `}questions.`, {total: 0, questions: []})

                const projectIds = [...new Set(list.map((q) => q.projectId))]
                const sessionIds = [...new Set(list.map((q) => q.sessionId))]
                const questionIds = list.map((q) => q._id)

                // Batch-load project titles, session flags, and per-question conversation context (including post-escalation replies before any newer question)
                const [projectRows, sessionRows, contextRows] = await Promise.all([
                    projects.find({_id: {$in: projectIds}}, {projection: {title: 1}}).toArray(),
                    sessions.find({_id: {$in: sessionIds}}, {projection: {endedAt: 1, endReason: 1, lastMessageAt: 1, humanHandledAt: 1, humanHandledBy: 1}}).toArray(),
                    questions
                        .aggregate<{_id: string; context: ChatMessage[]}>([
                            {$match: {_id: {$in: questionIds}}},
                            {
                                $lookup: {
                                    from: "questions",
                                    let: {sid: "$sessionId", qid: "$_id", at: "$createdAt"},
                                    pipeline: [{$match: {$expr: {$and: [{$eq: ["$sessionId", "$$sid"]}, {$ne: ["$_id", "$$qid"]}, {$gt: ["$createdAt", "$$at"]}]}}}, {$sort: {createdAt: 1}}, {$limit: 1}, {$project: {createdAt: 1}}],
                                    as: "nextQ"
                                }
                            },
                            {
                                $lookup: {
                                    from: "messages",
                                    let: {sid: "$sessionId", nextAt: {$first: "$nextQ.createdAt"}},
                                    pipeline: [
                                        {
                                            $match: {
                                                $expr: {
                                                    $and: [{$eq: ["$sessionId", "$$sid"]}, {$cond: [{$eq: [{$type: "$$nextAt"}, "date"]}, {$lt: ["$createdAt", "$$nextAt"]}, true]}]
                                                }
                                            }
                                        },
                                        {$sort: {createdAt: -1}},
                                        {$limit: CONTEXT_MESSAGES}
                                    ],
                                    as: "context"
                                }
                            },
                            {$project: {_id: 1, context: 1}}
                        ])
                        .toArray()
                ])

                const titles = new Map(projectRows.map((p) => [p._id, p.title]))
                const sessionById = new Map(sessionRows.map((s) => [s._id, s]))
                const contextById = new Map(contextRows.map((r) => [r._id, r.context]))

                const items = list.map((q) => {
                    const context = [...(contextById.get(q._id) ?? [])].reverse()
                    const sess = sessionById.get(q.sessionId)
                    const canSeeEmail = hasProjectPermission(ctx.user, q.projectId, "sessions:read")
                    const humanHandledBy = sess?.humanHandledAt ? (sess.humanHandledBy?.name ?? "Support team") : undefined
                    const ended = sess ? !!effectiveSessionEnd(sess, settings.chatAutoCloseDays).endedAt : false
                    return {
                        id: q._id,
                        projectId: q.projectId,
                        projectTitle: titles.get(q.projectId) ?? q.projectId,
                        sessionId: q.sessionId,
                        question: q.question,
                        reason: q.reason,
                        status: q.status,
                        visitorName: q.visitorName,
                        visitorHasEmail: !!q.visitorEmail,
                        visitorEmail: canSeeEmail ? q.visitorEmail : undefined,
                        humanHandledBy,
                        sessionEnded: ended,
                        answer: q.answer,
                        answeredBy: q.answeredBy ? {name: q.answeredBy.name, via: q.answeredBy.via} : undefined,
                        answeredAt: q.answeredAt,
                        createdAt: q.createdAt,
                        context: context.map((m) => {
                            const {id: _id, questionId: _q, sources: _s, ...rest} = mcpMessageView(m, CONTEXT_MESSAGE_CHARS)
                            return rest
                        })
                    }
                })

                const countLabel = total > items.length ? `${items.length} of ${total}` : `${items.length}`
                const summary = `${countLabel} ${status === "all" ? "" : `${status} `}question(s):\n${items.map((q) => `- [${q.projectTitle}] ${q.visitorName}: "${q.question.slice(0, 140)}" (id: ${q.id}, ${q.reason}${q.humanHandledBy ? `, human handling by ${q.humanHandledBy}` : ""}${q.visitorHasEmail ? ", visitor has email" : ""})`).join("\n")}`
                return mcpOk(summary, {total, questions: items})
            })
    )

    server.registerTool(
        "reply_to_question",
        {
            title: "Reply to a question",
            description:
                "Answers an open visitor question: posts the answer into the visitor's chat (unless post_to_chat=false or the conversation ended) and emails it when the visitor left an email and is not currently in the chat. Set add_to_faq=true only when the Q&A is reusable for future visitors. Requires questions:reply.",
            inputSchema: {
                question_id: z.string().min(1).describe("Question id (see list_unanswered_questions)"),
                answer: z.string().trim().min(1).max(8000).describe("The answer to send to the visitor (markdown). Write it directly to the visitor."),
                add_to_faq: z.boolean().default(false).describe("Add a sanitized copy of this Q&A to the project FAQ (default false; enable when generally useful)"),
                notify_visitor: z.boolean().default(true).describe("Email the answer to the visitor if they left an email and do not see it in the chat (default true)"),
                post_to_chat: z.boolean().default(true).describe("Post the answer into the chat session (set false when already answered in the chat, default true)"),
                allow_followup: z.boolean().default(false).describe("Allow replying to a question that was already answered (default false to prevent duplicate bot replies)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true}
        },
        ({question_id, answer, add_to_faq, notify_visitor, post_to_chat, allow_followup}) =>
            mcpSafely(ctx, "reply_to_question", async () => {
                await questionFor(ctx, question_id)
                const result = await replyToQuestion({
                    questionId: question_id,
                    answer,
                    author: {userId: ctx.user._id, name: mcpAuthorName(ctx), via: "mcp"},
                    addToFaq: add_to_faq,
                    notifyVisitor: notify_visitor,
                    postToChat: post_to_chat,
                    onlyOpen: !allow_followup
                })
                const data = {
                    questionId: result.question._id,
                    status: result.question.status,
                    messageId: result.message?._id,
                    sessionId: result.question.sessionId,
                    email: result.email,
                    emailDueAt: result.question.visitorEmailDueAt,
                    faqId: result.faq?._id
                }
                const emailText = {
                    sent: "and emailed to the visitor",
                    scheduled: `(the visitor is not in the chat: it will be emailed at ${result.question.visitorEmailDueAt ? new Date(result.question.visitorEmailDueAt).toISOString() : "a later time"} unless they open the chat)`,
                    seen: "(the visitor is in the chat, no email needed)",
                    failed: "(email could not be sent - check SMTP settings)",
                    none: "(visitor not emailed)"
                }[result.email]
                const chatText = result.message ? "Answer posted to the visitor's chat" : post_to_chat === false ? "Answer recorded (not posted to the chat)" : "Answer recorded (the conversation ended, not posted to the chat)"
                const parts = [chatText, emailText]
                if (result.faq) parts.push(`; added to FAQ (id: ${result.faq._id})`)
                return mcpOk(`${parts.join(" ")}.`, data)
            })
    )

    server.registerTool(
        "dismiss_question",
        {
            title: "Dismiss or reopen a question",
            description: "Dismisses a question that needs no answer (spam, duplicate, already solved), or reopens a dismissed question when `dismissed: false`. Requires questions:reply.",
            inputSchema: {
                question_id: z.string().min(1).describe("Question id"),
                dismissed: z.boolean().default(true).describe("true dismisses the question, false reopens a dismissed question")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}
        },
        ({question_id, dismissed}) =>
            mcpSafely(ctx, "dismiss_question", async () => {
                await questionFor(ctx, question_id)
                const question = dismissed ? await dismissQuestion(question_id) : await reopenQuestion(question_id)
                return mcpOk(`Question ${question._id} ${question.status}.`, {questionId: question._id, status: question.status})
            })
    )
}
