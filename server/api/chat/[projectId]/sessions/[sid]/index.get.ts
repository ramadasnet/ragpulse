// Restores a visitor's conversation (also used for polling human/bot agent replies).
// `?visible=1` reports that the visitor has the chat open and visible (decides whether answers are emailed).
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-poll", 400, 600_000)
    const session = await requireChatSession(event, project)
    if (getQuery(event).visible === "1") await markVisitorSeen(session._id)
    const {messages} = await useCollections()
    const list = await messages.find({sessionId: session._id}).sort({createdAt: 1}).limit(500).toArray()
    setResponseHeader(event, "Cache-Control", "no-store")
    return {session: publicChatSession(session), messages: list.map((m) => publicChatMessage(m, project))}
})
