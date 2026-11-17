import type {Faq} from "#shared/types"
import logger from "../../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "sources:manage")
    const body = await readIngestBody(event, faqInputSchema)
    const now = new Date()
    const faq: Faq = {_id: newId(), projectId: project._id, question: faqTextToMarkdown(body.question), answer: faqTextToMarkdown(body.answer), createdAt: now, updatedAt: now}
    const {faqs} = await useCollections()
    await faqs.insertOne(faq)
    setResponseStatus(event, 201)
    logger.info("Faqs.create", `FAQ ${faq._id}`, `Project ${project._id}`, `By ${user.email}`)
    try {
        await indexFaq(faq)
        return faq
    } catch (err: any) {
        logger.warn("Faqs.create", `Indexing of FAQ ${faq._id} failed`, err)
        return {...faq, indexError: String(err?.statusMessage || err?.message || err).slice(0, 300)}
    }
})
