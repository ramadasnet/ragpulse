import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import type {Question} from "#shared/types"
import {type McpContext, McpToolError, mcpAuthorName, mcpOk, mcpProject, mcpProjectIdsWith, mcpSafely} from "./context"
import {mcpMessageView} from "./sessions"

const CONTEXT_MESSAGES = 6
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
            description: "Lists visitor questions the chat assistant could not answer (escalations), newest first, each with the recent conversation as context. Without project_id, covers every project where you have questions:reply.",
            inputSchema: {
                project_id: z.string().min(1).optional().describe("Project id; omit to list across all projects you can reply in"),
                status: z.enum(["open", "answered", "dismissed", "all"]).default("open").describe('Question status filter (default "open")'),
                limit: z.number().int().min(1).max(200).default(50).describe("Max questions to return (1-200, default 50)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, status, limit}) =>
            mcpSafely(async () => {
                const {questions, projects, messages} = await useCollections()
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

                const list = await questions.find(filter).sort({createdAt: -1}).limit(limit).toArray()
                const projectIds = [...new Set(list.map((q) => q.projectId))]
                const titles = new Map((await projects.find({_id: {$in: projectIds}}, {projection: {title: 1}}).toArray()).map((p) => [p._id, p.title]))

                const items = await Promise.all(
                    list.map(async (q) => {
                        // Conversation up to (and shortly after) the question, so the assistant's fallback reply is included
                        const until = new Date(new Date(q.createdAt).getTime() + 120_000)
                        const context = await messages
                            .find({sessionId: q.sessionId, createdAt: {$lte: until}})
                            .sort({createdAt: -1})
                            .limit(CONTEXT_MESSAGES)
                            .toArray()
                        const canSeeEmail = hasProjectPermission(ctx.user, q.projectId, "sessions:read")
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
                            answer: q.answer,
                            answeredBy: q.answeredBy ? {name: q.answeredBy.name, via: q.answeredBy.via} : undefined,
                            answeredAt: q.answeredAt,
                            createdAt: q.createdAt,
                            context: context.reverse().map((m) => {
                                const {id: _id, questionId: _q, sources: _s, ...rest} = mcpMessageView(m, CONTEXT_MESSAGE_CHARS)
                                return rest
                            })
                        }
                    })
                )

                const summary = items.length
                    ? `${items.length} ${status === "all" ? "" : `${status} `}question(s):\n${items.map((q) => `- [${q.projectTitle}] ${q.visitorName || "Visitor"}: "${q.question.slice(0, 140)}" (id: ${q.id}, ${q.reason}${q.visitorHasEmail ? ", visitor will be emailed" : ""})`).join("\n")}`
                    : `No ${status === "all" ? "" : `${status} `}questions.`
                return mcpOk(summary, {questions: items})
            })
    )

    server.registerTool(
        "reply_to_question",
        {
            title: "Reply to a question",
            description:
                "Answers a visitor question: the answer is posted into the visitor's chat (unless the conversation ended) and added to the project FAQ (once per question) so the assistant can answer it next time. When the visitor left an email and is not in the chat, the answer is emailed after the configured delay unless they open the chat meanwhile. Requires questions:reply.",
            inputSchema: {
                question_id: z.string().min(1).describe("Question id (see list_unanswered_questions)"),
                answer: z.string().trim().min(1).max(8000).describe("The answer to send to the visitor (markdown). Write it directly to the visitor."),
                add_to_faq: z.boolean().default(true).describe("Add this question and answer to the project FAQ (knowledge base), default true"),
                notify_visitor: z.boolean().default(true).describe("Email the answer to the visitor if they left an email and do not see it in the chat (default true)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true}
        },
        ({question_id, answer, add_to_faq, notify_visitor}) =>
            mcpSafely(async () => {
                await questionFor(ctx, question_id)
                const result = await replyToQuestion({
                    questionId: question_id,
                    answer,
                    author: {userId: ctx.user._id, name: mcpAuthorName(ctx), via: "mcp"},
                    addToFaq: add_to_faq,
                    notifyVisitor: notify_visitor
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
                    failed: "(email could not be sent — check SMTP settings)",
                    none: "(visitor not emailed)"
                }[result.email]
                const parts = [result.message ? "Answer posted to the visitor's chat" : "Answer recorded (the conversation ended, not posted to the chat)", emailText]
                if (result.faq) parts.push(`; added to FAQ (id: ${result.faq._id})`)
                return mcpOk(`${parts.join(" ")}.`, data)
            })
    )

    server.registerTool(
        "dismiss_question",
        {
            title: "Dismiss a question",
            description: "Dismisses a question that needs no answer (spam, duplicate, already solved). Requires questions:reply.",
            inputSchema: {question_id: z.string().min(1).describe("Question id")},
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}
        },
        ({question_id}) =>
            mcpSafely(async () => {
                await questionFor(ctx, question_id)
                const question = await dismissQuestion(question_id)
                return mcpOk(`Question ${question._id} dismissed.`, {questionId: question._id, status: question.status})
            })
    )
}
