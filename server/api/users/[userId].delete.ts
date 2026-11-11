export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const userId = getRouterParam(event, 'userId')!
  if (userId === admin._id) throw createError({ statusCode: 400, statusMessage: 'You cannot delete your own account' })
  const { users, apiTokens } = await useCollections()
  const target = await users.findOne({ _id: userId })
  if (!target) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  if (target.role === 'admin' && !target.disabled && await countOtherActiveAdmins(target._id) === 0) {
    throw createError({ statusCode: 400, statusMessage: 'At least one active admin is required' })
  }
  await apiTokens.deleteMany({ userId: target._id })
  await users.deleteOne({ _id: target._id })
  return { ok: true }
})
