import logger from "../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "sources:manage")
    const queued = await requestSync(project._id)
    logger.info("Projects.sync", `Project ${project._id}`, `By ${user.email}`, `Queued ${queued} source(s)`)
    return {queued}
})
