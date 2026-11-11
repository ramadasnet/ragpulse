export default defineEventHandler(async (event) => {
  const { user, project } = await requireProjectAccess(event, 'settings:edit')
  const patch = await readZodBody(event, projectUpdateSchema)
  const { $set, $unset } = buildProjectUpdate(project, patch)
  const { projects } = await useCollections()
  const updated = await projects.findOneAndUpdate(
    { _id: project._id },
    Object.keys($unset).length ? { $set, $unset } : { $set },
    { returnDocument: 'after' }
  )
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  invalidateChatProject(project._id)
  if (patch.refreshIntervalHours !== undefined && patch.refreshIntervalHours !== project.refreshIntervalHours) {
    await rescheduleProjectSources(project._id)
  }
  return { ...updated, permissions: projectPermissions(user, project._id) }
})
