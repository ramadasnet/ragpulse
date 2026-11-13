export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const sourceId = getRouterParam(event, "sourceId")
    const {sources} = await useCollections()
    const source = await sources.findOne({_id: sourceId, projectId: project._id})
    if (!source) throw createError({statusCode: 404, statusMessage: "Source not found"})
    return serializeSource(source)
})
