export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { users } = await useCollections()
  const list = await users.find({}).sort({ createdAt: 1 }).toArray()
  return list.map(serializeUser)
})
