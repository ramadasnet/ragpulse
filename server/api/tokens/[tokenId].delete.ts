export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const tokenId = getRouterParam(event, 'tokenId')
  if (!tokenId) throw createError({ statusCode: 400, statusMessage: 'Missing token id' })
  const { apiTokens } = await useCollections()
  const filter = user.role === 'admin' ? { _id: tokenId } : { _id: tokenId, userId: user._id }
  const res = await apiTokens.deleteOne(filter)
  if (!res.deletedCount) throw createError({ statusCode: 404, statusMessage: 'Token not found' })
  return { ok: true }
})
