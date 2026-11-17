import logger from "../../../../utils/logger"

export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "sources:manage")
    const faqId = getRouterParam(event, "faqId")
    const {faqs, questions} = await useCollections()
    const res = await faqs.deleteOne({_id: faqId, projectId: project._id})
    if (!res.deletedCount) throw createError({statusCode: 404, statusMessage: "FAQ not found"})
    await removeFaqIndex(faqId!)
    await questions.updateMany({projectId: project._id, faqId}, {$unset: {faqId: ""}})
    logger.info("Faqs.delete", `FAQ ${faqId}`, `Project ${project._id}`, `By ${user.email}`)
    return {ok: true}
})
