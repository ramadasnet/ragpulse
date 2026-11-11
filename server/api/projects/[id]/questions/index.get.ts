const STATUSES = ['open', 'answered', 'dismissed', 'all'] as const

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'questions:reply')
  const status = String(getQuery(event).status || 'open') as (typeof STATUSES)[number]
  if (!STATUSES.includes(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  const { questions } = await useCollections()
  const filter: Record<string, any> = { projectId: project._id }
  if (status !== 'all') filter.status = status
  return questions.find(filter).sort({ createdAt: -1 }).limit(200).toArray()
})
