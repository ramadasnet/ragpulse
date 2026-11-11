export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { project } = await requireProjectAccess(event)
  await deleteProjectCascade(project._id)
  invalidateChatProject(project._id)
  return { ok: true }
})
