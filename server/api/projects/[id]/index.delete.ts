import logger from "../../../utils/logger"

export default defineEventHandler(async (event) => {
    const admin = await requireAdmin(event)
    const {project} = await requireProjectAccess(event)
    await deleteProjectCascade(project._id)
    invalidateChatProject(project._id)
    logger.info("Projects.delete", `Project ${project._id} "${project.title}"`, `By ${admin.email}`)
    return {ok: true}
})
