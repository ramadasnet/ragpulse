import {z} from "zod"
import type {ChatMessage} from "#shared/types"

const schema = z.object({content: z.string().trim().min(1, "Message cannot be empty").max(8000)})

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "questions:reply")
    const sid = getRouterParam(event, "sid")
    const {content} = await readZodBody(event, schema)
    const {sessions, messages} = await useCollections()
    const session = await sessions.findOne({_id: sid, projectId: project._id}, {projection: {_id: 1, endedAt: 1, endReason: 1, lastMessageAt: 1}})
    if (!session) throw createError({statusCode: 404, statusMessage: "Conversation not found"})
    await assertSessionNotEnded(session)

    const author = {userId: user._id, name: user.name, via: "admin" as const}
    const now = new Date()
    const message: ChatMessage = {
        _id: newId(),
        projectId: project._id,
        sessionId: session._id,
        role: "agent",
        content,
        author,
        createdAt: now
    }
    await messages.insertOne(message)
    await sessions.updateOne({_id: session._id}, {$inc: {messageCount: 1}, $set: {lastMessageAt: now}, $unset: {finishedAt: "", finishedBy: ""}})
    await claimHumanHandling(session._id, author)
    setResponseStatus(event, 201)
    return message
})
