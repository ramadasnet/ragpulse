import logger from "../../../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "sources:manage")
    const sourceId = getRouterParam(event, "sourceId")
    const {sources} = await useCollections()
    const source = await sources.findOne({_id: sourceId, projectId: project._id}, {projection: {_id: 1, title: 1, type: 1}})
    if (!source) throw createError({statusCode: 404, statusMessage: "Source not found"})
    await sources.deleteOne({_id: source._id})
    await deleteSourceData(source._id)
    logger.info("Sources.delete", `Source ${source._id} "${source.title}" (${source.type})`, `Project ${project._id}`, `By ${user.email}`)
    return {ok: true}
})
