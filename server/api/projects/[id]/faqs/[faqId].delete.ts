export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const faqId = getRouterParam(event, 'faqId')
  const { faqs } = await useCollections()
  const res = await faqs.deleteOne({ _id: faqId, projectId: project._id })
  if (!res.deletedCount) throw createError({ statusCode: 404, statusMessage: 'FAQ not found' })
  await removeFaqIndex(faqId!)
  return { ok: true }
})
