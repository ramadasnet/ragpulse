import { z } from 'zod'
import type { ChatMessage } from '#shared/types'

const schema = z.object({
  email: z.union([z.literal(''), z.email().max(200)]).optional(),
  question: z.string().trim().max(CHAT_MAX_MESSAGE_CHARS).optional()
})

/**
 * Visitor asks the team directly:
 * - `{email, question}` (message limit reached / contact form) → records a question
 * - `{email}` only (after an escalated answer) → attaches the email to the session and its open questions
 */
export default defineEventHandler(async (event) => {
  const project = await requireChatProject(event)
  enforceRateLimit(event, 'chat-escalate', 10, 3600_000)
  const session = await requireChatSession(event, project)

  const parsed = schema.safeParse(await readLimitedJson(event, 12_288))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  const email = parsed.data.email?.toLowerCase() || undefined
  const text = parsed.data.question || ''
  if (!email && !text) throw createError({ statusCode: 400, statusMessage: 'Please enter your email or a question' })

  const { sessions, questions, messages } = await useCollections()
  if (email && email !== session.visitorEmail) {
    await sessions.updateOne({ _id: session._id }, { $set: { visitorEmail: email } })
    await questions.updateMany(
      { sessionId: session._id, status: 'open', $or: [{ visitorEmail: { $exists: false } }, { visitorEmail: { $type: 'null' } }, { visitorEmail: '' }] },
      { $set: { visitorEmail: email, updatedAt: new Date() } }
    )
    session.visitorEmail = email
  }

  let message: ChatMessage | undefined
  let questionId: string | undefined
  if (text) {
    const now = new Date()
    message = { _id: newId(), projectId: project._id, sessionId: session._id, role: 'user', content: text, createdAt: now }
    await messages.insertOne(message)
    await sessions.updateOne({ _id: session._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } })
    const question = await createQuestion({
      project,
      session,
      question: text,
      reason: session.limitReached ? 'rate_limit' : 'user_request',
      messageId: message._id,
      visitorEmail: email
    })
    questionId = question._id
  }

  return {
    ok: true,
    questionId,
    message: message ? publicChatMessage(message) : undefined,
    session: publicChatSession(session)
  }
})
