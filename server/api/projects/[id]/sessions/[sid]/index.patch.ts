import {z} from "zod"
import logger from "../../../../../utils/logger"

const schema = z.object({finished: z.boolean()})

/** Flags a conversation as finished (or reopens it). Finishing learns a FAQ from human replies. */
export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "questions:reply")
    const sid = getRouterParam(event, "sid")
    const {finished} = await readZodBody(event, schema)
    const {sessions} = await useCollections()
    const session = await sessions.findOne({_id: sid, projectId: project._id}, {projection: SESSION_SAFE_PROJECTION})
    if (!session) throw createError({statusCode: 404, statusMessage: "Conversation not found"})
    logger.info("Sessions.finish", `Session ${session._id}`, `Project ${project._id}`, `${finished ? "Finished" : "Reopened"} by ${user.name} (${user.email})`)
    return finishSession({session, finished, author: {userId: user._id, name: user.name, via: "admin"}})
})
