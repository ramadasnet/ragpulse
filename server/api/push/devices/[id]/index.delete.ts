import logger from "../../../../utils/logger"

/** Removes the push subscription of the current device (notifications turned off, or signing out). */
export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    const {pushDevices} = await useCollections()
    const res = await pushDevices.deleteOne({_id: getRouterParam(event, "id"), userId: user._id})
    if (res.deletedCount) logger.info("Push.devices", `Device ${getRouterParam(event, "id")}`, `User ${user.email}`, "Unsubscribed")
    return {ok: true}
})
