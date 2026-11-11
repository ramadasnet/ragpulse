export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const { sources } = await useCollections()
  const list = await sources.find({ projectId: project._id }).sort({ createdAt: 1 }).toArray()
  return list.map(serializeSource)
})
