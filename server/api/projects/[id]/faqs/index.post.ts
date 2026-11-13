import type {Faq} from "#shared/types"

export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const body = await readIngestBody(event, faqInputSchema)
    const now = new Date()
    const faq: Faq = {_id: newId(), projectId: project._id, question: body.question, answer: body.answer, createdAt: now, updatedAt: now}
    const {faqs} = await useCollections()
    await faqs.insertOne(faq)
    setResponseStatus(event, 201)
    try {
        await indexFaq(faq)
        return faq
    } catch (err: any) {
        return {...faq, indexError: String(err?.statusMessage || err?.message || err).slice(0, 300)}
    }
})
