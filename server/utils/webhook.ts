import type {ChatSession, Project, Question} from "#shared/types"
import {DEFAULT_ESCALATION_WEBHOOK_BODY, renderWebhookBody} from "#shared/utils/webhook"
import logger from "./logger"
import {safeFetch} from "./public-url"

/** Conversation messages included in the webhook body are capped (sessions are small, this is a guard). */
const WEBHOOK_MAX_MESSAGES = 500
const WEBHOOK_TIMEOUT_MS = 15_000

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
        const body = renderWebhookBody(webhook.bodyTemplate || DEFAULT_ESCALATION_WEBHOOK_BODY, {
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
        try {
            JSON.parse(body)
        } catch {
            logger.warn("Webhook.escalation", `Body of project ${project._id} does not render valid JSON, webhook not sent`)
            return
        }
        const headers = new Headers(webhook.headers)
        if (!headers.has("content-type")) headers.set("content-type", "application/json")
        const res = await safeFetch(webhook.url, {method: "POST", headers, body, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)}, "Escalation webhook", {sameOriginOnly: true})
        await res.body?.cancel().catch(() => {})
        if (!res.ok) {
            logger.warn("Webhook.escalation", `Project ${project._id} webhook returned ${res.status}`)
            return
        }
        question.webhookSentAt = new Date()
        await questions.updateOne({_id: question._id}, {$set: {webhookSentAt: question.webhookSentAt}})
        logger.info("Webhook.escalation", `Project ${project._id}`, `Question ${question._id}`, `Delivered to ${new URL(webhook.url).host}`)
    } catch (err) {
        logger.warn("Webhook.escalation", `Project ${project._id} webhook failed`, err)
    }
}
