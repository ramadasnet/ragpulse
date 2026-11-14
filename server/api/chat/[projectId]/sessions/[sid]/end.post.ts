// The visitor starts a new conversation: the current one is ended and the team can no longer post into it.
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-end", 20, 3600_000)
    const session = await requireChatSession(event, project)
    const {sessions} = await useCollections()
    await sessions.updateOne({_id: session._id, endedAt: {$exists: false}}, {$set: {endedAt: new Date(), endReason: "visitor"}})
    return {ok: true}
})
