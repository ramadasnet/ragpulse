import logger from "../../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "sources:manage")
    const faqId = getRouterParam(event, "faqId")
    const body = await readIngestBody(event, faqPatchInputSchema)
    const {faqs} = await useCollections()
    // Pasted HTML becomes Markdown before it is stored
    if (body.question) body.question = faqTextToMarkdown(body.question)
    if (body.answer) body.answer = faqTextToMarkdown(body.answer)
    const faq = await faqs.findOneAndUpdate({_id: faqId, projectId: project._id}, {$set: {...body, updatedAt: new Date()}}, {returnDocument: "after"})
    if (!faq) throw createError({statusCode: 404, statusMessage: "FAQ not found"})
    logger.info("Faqs.update", `FAQ ${faq._id}`, `Project ${project._id}`, `By ${user.email}`)
    try {
        await indexFaq(faq)
        return faq
    } catch (err: any) {
        logger.warn("Faqs.update", `Indexing of FAQ ${faq._id} failed`, err)
        return {...faq, indexError: String(err?.statusMessage || err?.message || err).slice(0, 300)}
    }
})
