import {z} from "zod"

const schema = z.object({
    answer: z.string().trim().min(1, "Answer cannot be empty").max(8000),
    /** Default true: the answer is added to the FAQ (once per question) */
    addToFaq: z.boolean().optional(),
    /** False when the visitor already got the answer in the chat: only records it */
    postToChat: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "questions:reply")
    const qid = getRouterParam(event, "qid")
    const body = await readZodBody(event, schema)
    const {questions} = await useCollections()
    const question = await questions.findOne({_id: qid, projectId: project._id}, {projection: {_id: 1}})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    return replyToQuestion({
        questionId: question._id,
        answer: body.answer,
        author: {userId: user._id, name: user.name, via: "admin"},
        addToFaq: body.addToFaq,
        postToChat: body.postToChat
    })
})
