import {z} from "zod"

const schema = z.object({finished: z.boolean()})

/** Gives a conversation back to the assistant (flags it as finished, or reopens it). A FAQ is learned from human replies in the background. */
export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "questions:reply")
    const sid = getRouterParam(event, "sid")
    const {finished} = await readZodBody(event, schema)
    const {sessions} = await useCollections()
    const session = await sessions.findOne({_id: sid, projectId: project._id}, {projection: SESSION_SAFE_PROJECTION})
    if (!session) throw createError({statusCode: 404, statusMessage: "Conversation not found"})
    return finishSession({session, finished, author: {userId: user._id, name: user.name, via: "admin"}, learnInBackground: true})
})
