export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listModels(getQuery(event).type === 'embedding' ? 'embedding' : 'chat')
})
