export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const sourceId = getRouterParam(event, 'sourceId')
  const { sources } = await useCollections()
  const source = await sources.findOne({ _id: sourceId, projectId: project._id }, { projection: { _id: 1, status: 1 } })
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Source not found' })
  const queued = await requestSync(project._id, source._id)
  return { queued, alreadySyncing: source.status === 'syncing' }
})
