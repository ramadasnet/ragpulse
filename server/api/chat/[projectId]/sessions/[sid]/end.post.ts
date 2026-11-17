import logger from "../../../../../utils/logger"

// The visitor starts a new conversation: the current one is ended and the team can no longer post into it.
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event)
    enforceRateLimit(event, "chat-end", 20, 3600_000)
    const session = await requireChatSession(event, project)
    const {sessions} = await useCollections()
    const res = await sessions.updateOne({_id: session._id, endedAt: {$exists: false}}, {$set: {endedAt: new Date(), endReason: "visitor"}})
    if (res.modifiedCount) logger.info("Chat.end", `Session ${session._id}`, `Project ${project._id}`, "Ended by visitor")
    return {ok: true}
})
