import type {ChatSession, EscalationWebhook, Project, Question} from "#shared/types"
import {DEFAULT_ESCALATION_WEBHOOK_BODY, renderWebhookBody} from "#shared/utils/webhook"
import logger from "./logger"
import {safeFetch} from "./public-url"

/** Conversation messages included in the webhook body are capped (sessions are small, this is a guard). */
const WEBHOOK_MAX_MESSAGES = 500
const WEBHOOK_TIMEOUT_MS = 15_000

/** Renders the webhook body template, checks it parses as JSON, and POSTs it via `safeFetch`. */
async function postEscalationWebhook(webhook: EscalationWebhook, data: Record<string, unknown>): Promise<{ok: boolean; status: number} | {invalidJson: true}> {
    const body = renderWebhookBody(webhook.bodyTemplate || DEFAULT_ESCALATION_WEBHOOK_BODY, data)
    try {
        JSON.parse(body)
    } catch {
        return {invalidJson: true}
    }
    const headers = new Headers(webhook.headers)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
    const res = await safeFetch(webhook.url, {method: "POST", headers, body, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)}, "Escalation webhook", {sameOriginOnly: true})
    await res.body?.cancel().catch(() => {})
    return {ok: res.ok, status: res.status}
}

/**
 * POSTs the project's escalation webhook for a newly escalated question: renders the editable body
 * template (`{{placeholder}}` → JSON value) and delivers it with the configured headers through
 * `safeFetch`, so private/reserved targets and redirect hops are checked like every other
 * admin-configured URL; redirects to another origin are refused so the headers and transcript stay with the
 * configured host. `chatUrl` is the origin embedding the widget, or the standalone chat page.
 * Never throws; marks `question.webhookSentAt` on success.
 */
export async function sendEscalationWebhook(project: Project, session: ChatSession, question: Question): Promise<void> {
    const webhook = project.escalationWebhook
    if (!webhook?.url) return
    try {
        const {messages, questions} = await useCollections()
        const list = await messages.find({sessionId: session._id}).sort({createdAt: 1}).limit(WEBHOOK_MAX_MESSAGES).toArray()
        const result = await postEscalationWebhook(webhook, {
            projectId: project._id,
            projectTitle: project.title,
            chatUrl: session.origin || publicUrl("chat", `/chat/${project._id}`),
            questionUrl: publicUrl("admin", `/admin/projects/${project._id}/questions?q=${question._id}`),
            sessionId: session._id,
            questionId: question._id,
            reason: question.reason,
            visitorName: question.visitorName || session.visitorName,
            visitorEmail: question.visitorEmail || session.visitorEmail || "",
            question: question.question,
            messages: list.map((m) => ({role: m.role, content: m.content, createdAt: m.createdAt})),
            createdAt: new Date(question.createdAt).toISOString()
        })
        if ("invalidJson" in result) {
            logger.warn("Webhook.escalation", `Body of project ${project._id} does not render valid JSON, webhook not sent`)
            return
        }
        if (!result.ok) {
            logger.warn("Webhook.escalation", `Project ${project._id} webhook returned ${result.status}`)
            return
        }
        question.webhookSentAt = new Date()
        await questions.updateOne({_id: question._id}, {$set: {webhookSentAt: question.webhookSentAt}})
        logger.info("Webhook.escalation", `Project ${project._id}`, `Question ${question._id}`, `Delivered to ${urlForLog(webhook.url)}`)
    } catch (err) {
        logger.warn("Webhook.escalation", `Project ${project._id} webhook failed`, err)
    }
}

/**
 * Sends a synthetic escalation event to test a webhook configuration (saved or unsaved).
 * Throws an HTTP error with a readable message when the template is invalid JSON or delivery fails.
 */
export async function sendTestEscalationWebhook(project: Project, webhook: EscalationWebhook): Promise<{status: number}> {
    const now = new Date()
    let result: Awaited<ReturnType<typeof postEscalationWebhook>>
    try {
        result = await postEscalationWebhook(webhook, {
            projectId: project._id,
            projectTitle: project.title,
            chatUrl: publicUrl("chat", `/chat/${project._id}`),
            questionUrl: publicUrl("admin", `/admin/projects/${project._id}/questions`),
            sessionId: "test-session",
            questionId: "test-question",
            reason: "user_request",
            visitorName: "Test Visitor",
            visitorEmail: "visitor@example.com",
            question: "This is a test escalation event from RAGPulse.",
            messages: [
                {role: "user", content: "This is a test escalation event from RAGPulse.", createdAt: now},
                {role: "assistant", content: "I'll pass this along to our support team right away.", createdAt: now}
            ],
            createdAt: now.toISOString()
        })
    } catch (err: any) {
        const detail = err?.name === "TimeoutError" ? "request timed out" : String(err?.message || "request failed").slice(0, 200)
        throw createError({statusCode: 502, statusMessage: `Webhook delivery failed: ${detail}`})
    }
    if ("invalidJson" in result) throw createError({statusCode: 400, statusMessage: "Body template does not render valid JSON"})
    if (!result.ok) throw createError({statusCode: 502, statusMessage: `Webhook returned HTTP ${result.status}`})
    return {status: result.status}
}
