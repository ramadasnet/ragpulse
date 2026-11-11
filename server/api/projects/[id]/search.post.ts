export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const body = await readIngestBody(event, knowledgeSearchSchema)
  return searchKnowledge(project._id, body.query, { limit: body.limit ?? 8 })
})
