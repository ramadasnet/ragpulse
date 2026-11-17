import logger from "../../utils/logger"

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const userId = getRouterParam(event, "userId")!
    if (userId === admin._id) throw createError({statusCode: 400, statusMessage: "You cannot delete your own account"})
    const {users, apiTokens} = await useCollections()
    const target = await users.findOne({_id: userId})
    if (!target) throw createError({statusCode: 404, statusMessage: "User not found"})
    if (target.role === "admin" && !target.disabled && (await countOtherActiveAdmins(target._id)) === 0) {
        throw createError({statusCode: 400, statusMessage: "At least one active admin is required"})
    }
    await apiTokens.deleteMany({userId: target._id})
    const res = await users.deleteOne({_id: target._id})
    if (!res.deletedCount) throw createError({statusCode: 404, statusMessage: "User not found"})
    logger.info("Users.delete", `User ${target._id} ${target.email} (${target.role})`, `By ${admin.email}`)
    return {ok: true}
})
