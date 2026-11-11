export default defineEventHandler(async (event) => {
  const { user, project } = await requireProjectAccess(event)
  return { ...project, permissions: projectPermissions(user, project._id) }
})
