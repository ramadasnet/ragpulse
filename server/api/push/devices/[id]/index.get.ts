/** Notifications enabled on the current device (`id` = sha256 of its push endpoint). */
export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    const {pushDevices} = await useCollections()
    const device = await pushDevices.findOne({_id: getRouterParam(event, "id"), userId: user._id}, {projection: {events: 1}})
    if (!device) throw createError({statusCode: 404, statusMessage: "Device not subscribed"})
    return {_id: device._id, events: device.events}
})
