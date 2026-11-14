export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const faqId = getRouterParam(event, "faqId")
    const {faqs, questions} = await useCollections()
    const res = await faqs.deleteOne({_id: faqId, projectId: project._id})
    if (!res.deletedCount) throw createError({statusCode: 404, statusMessage: "FAQ not found"})
    await removeFaqIndex(faqId!)
    await questions.updateMany({projectId: project._id, faqId}, {$unset: {faqId: ""}})
    return {ok: true}
})
