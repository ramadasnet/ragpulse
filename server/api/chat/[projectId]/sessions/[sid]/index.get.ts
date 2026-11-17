// Restores a visitor's conversation (also used for polling human/bot agent replies).
// `?visible=1` reports that the visitor has the chat open and visible (decides whether answers are emailed).
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-poll", 400, 600_000)
    const session = await requireChatSession(event, project)
    const visible = getQuery(event).visible
    // `visible=0` clears the presence flag: the visitor closed the chat, so pending answers get emailed
    if (visible === "1") await markVisitorSeen(session._id)
    else if (visible === "0") await markVisitorAway(session._id)
    // Nobody took over the escalated chat within the configured wait: post the email fallback notice once
    await maybePostEmailFallback(project, session)
    const {messages} = await useCollections()
    const list = await messages.find({sessionId: session._id}).sort({createdAt: 1}).limit(500).toArray()
    setResponseHeader(event, "Cache-Control", "no-store")
    return {session: publicChatSession(session), messages: list.map((m) => publicChatMessage(m, project))}
})
