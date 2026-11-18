const STATUSES = ["open", "answered", "dismissed", "all"] as const

/** Questions of a project by status, each flagged with whether its visitor has the chat open right now. */
export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "questions:reply")
    const status = String(getQuery(event).status || "open") as (typeof STATUSES)[number]
    if (!STATUSES.includes(status)) throw createError({statusCode: 400, statusMessage: "Invalid status"})
    const {questions, sessions} = await useCollections()
    const filter: Record<string, any> = {projectId: project._id}
    if (status !== "all") filter.status = status
    const list = await questions.find(filter).sort({createdAt: -1}).limit(200).toArray()
    const now = Date.now()
    const present = await sessions.find({_id: {$in: [...new Set(list.map((q) => q.sessionId))]}}, {projection: {visitorSeenAt: 1, endedAt: 1}}).toArray()
    const inChat = new Set(present.filter((s) => visitorInChat(s, now)).map((s) => s._id))
    return list.map((q) => ({...q, visitorInChat: inChat.has(q.sessionId)}))
})
