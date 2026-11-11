import type { ChatSession } from '#shared/types'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sessions:read')
  const sid = getRouterParam(event, 'sid')
  const { sessions, messages, questions } = await useCollections()
  const session = await sessions.findOne({ _id: sid, projectId: project._id }, { projection: SESSION_SAFE_PROJECTION }) as Omit<ChatSession, 'tokenHash' | 'ipHash'> | null
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  const [list, qs] = await Promise.all([
    messages.find({ sessionId: session._id }).sort({ createdAt: 1 }).limit(2000).toArray(),
    questions.find({ sessionId: session._id }).sort({ createdAt: 1 }).toArray()
  ])
  return { session, messages: list, questions: qs }
})
