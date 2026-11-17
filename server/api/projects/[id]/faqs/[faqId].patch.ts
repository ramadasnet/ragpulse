export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const faqId = getRouterParam(event, "faqId")
    const body = await readIngestBody(event, faqPatchInputSchema)
    const {faqs} = await useCollections()
    // Pasted HTML becomes Markdown before it is stored
    if (body.question) body.question = faqTextToMarkdown(body.question)
    if (body.answer) body.answer = faqTextToMarkdown(body.answer)
    const faq = await faqs.findOneAndUpdate({_id: faqId, projectId: project._id}, {$set: {...body, updatedAt: new Date()}}, {returnDocument: "after"})
    if (!faq) throw createError({statusCode: 404, statusMessage: "FAQ not found"})
    try {
        await indexFaq(faq)
        return faq
    } catch (err: any) {
        return {...faq, indexError: String(err?.statusMessage || err?.message || err).slice(0, 300)}
    }
})
