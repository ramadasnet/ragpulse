export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const sourceId = getRouterParam(event, "sourceId")
    const {sources, syncRuns} = await useCollections()
    const source = await sources.findOne({_id: sourceId, projectId: project._id}, {projection: {_id: 1}})
    if (!source) throw createError({statusCode: 404, statusMessage: "Source not found"})
    const filter = {sourceId, projectId: project._id}
    const [runs, total, settings] = await Promise.all([syncRuns.find(filter).sort({startedAt: -1}).limit(200).toArray(), syncRuns.countDocuments(filter), getAppSettings()])
    return {runs, total, retentionDays: settings.syncHistoryDays}
})
