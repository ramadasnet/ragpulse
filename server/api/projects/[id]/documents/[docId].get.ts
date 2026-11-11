export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const docId = getRouterParam(event, 'docId')
  const { documents } = await useCollections()
  const doc = await documents.findOne({ _id: docId, projectId: project._id })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  return doc
})
