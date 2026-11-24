import type {ChatSession} from "#shared/types"

/**
 * Takeovers started before replies stamped `humanHandledAt` with their own time recorded the stamp just after the reply was saved.
 * This margin still counts that reply, while replies from an earlier takeover stay excluded.
 */
const TAKEOVER_REPLY_GRACE_MS = 5_000

export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sessions:read")
    const sid = getRouterParam(event, "sid")
    const {sessions, messages, questions} = await useCollections()
    const session = (await sessions.findOne({_id: sid, projectId: project._id}, {projection: SESSION_SAFE_PROJECTION})) as Omit<ChatSession, "tokenHash" | "ipHash"> | null
    if (!session) throw createError({statusCode: 404, statusMessage: "Conversation not found"})
    await sessionEnded(session)
    const [list, qs, humanReply] = await Promise.all([
        messages.find({sessionId: session._id}).sort({createdAt: 1}).limit(2000).toArray(),
        questions.find({sessionId: session._id}).sort({createdAt: 1}).toArray(),
        session.humanHandledAt && !session.endedAt && !session.finishedAt
            ? messages.findOne({sessionId: session._id, role: "agent", "author.via": "admin", createdAt: {$gte: new Date(new Date(session.humanHandledAt).getTime() - TAKEOVER_REPLY_GRACE_MS)}}, {projection: {_id: 1}})
            : null
    ])
    return {session, messages: list, questions: qs, canGiveBack: !!humanReply}
})
