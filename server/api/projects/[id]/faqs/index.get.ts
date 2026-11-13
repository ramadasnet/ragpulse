export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const {faqs} = await useCollections()
    return faqs.find({projectId: project._id}).sort({createdAt: -1}).toArray()
})
