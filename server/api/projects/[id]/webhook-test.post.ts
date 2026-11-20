import logger from "../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "settings:edit")
    const webhook = await readZodBody(event, escalationWebhookSchema)
    if (!webhook.url) throw createError({statusCode: 400, statusMessage: "Webhook URL is required"})
    const {status} = await sendTestEscalationWebhook(project, webhook)
    logger.info("Webhook.test", `Project ${project._id}`, `By ${user.email}`, `Delivered to ${urlForLog(webhook.url)} (HTTP ${status})`)
    return {ok: true, status}
})
