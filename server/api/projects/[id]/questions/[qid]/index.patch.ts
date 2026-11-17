import {z} from "zod"

const schema = z.object({status: z.enum(["dismissed", "open"])})

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "questions:reply")
    const qid = getRouterParam(event, "qid")
    const {status} = await readZodBody(event, schema)
    const {questions} = await useCollections()
    const question = await questions.findOne({_id: qid, projectId: project._id}, {projection: {_id: 1}})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    return status === "dismissed" ? dismissQuestion(question._id, user.email) : reopenQuestion(question._id, user.email)
})
