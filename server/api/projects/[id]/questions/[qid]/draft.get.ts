/** Draft answer summarized from the human replies posted in the chat after the question was asked. */
export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "questions:reply")
    const qid = getRouterParam(event, "qid")
    const {questions} = await useCollections()
    const question = await questions.findOne({_id: qid, projectId: project._id})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status !== "open") return {humanReplies: 0, draft: ""}
    return draftAnswerFromChat(question, project)
})
