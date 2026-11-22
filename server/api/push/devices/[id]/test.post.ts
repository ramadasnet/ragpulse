/** Sends a test notification to the current device. */
export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    enforceRateLimit(event, "push-test", 10, 600_000)
    const {pushDevices} = await useCollections()
    const device = await pushDevices.findOne({_id: getRouterParam(event, "id"), userId: user._id})
    if (!device) throw createError({statusCode: 404, statusMessage: "Device not subscribed"})
    let status: number
    try {
        status = await sendPush(device, {title: "RAGPulse", body: "Notifications are working on this device.", url: "/admin/notifications", tag: "test"})
    } catch (err: any) {
        throw createError({statusCode: 502, statusMessage: `Push delivery failed: ${String(err?.message || "request failed").slice(0, 200)}`})
    }
    if (status === 404 || status === 410) {
        await pushDevices.deleteOne({_id: device._id})
        throw createError({statusCode: 410, statusMessage: "The subscription expired, turn notifications off and on again"})
    }
    if (status >= 300) throw createError({statusCode: 502, statusMessage: `Push service returned HTTP ${status}`})
    return {ok: true}
})
