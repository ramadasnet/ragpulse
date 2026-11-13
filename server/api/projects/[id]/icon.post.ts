export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event, "settings:edit")
    const settings = await getAppSettings()
    const icon = await detectProjectFavicon(project.website, {userAgent: settings.userAgent || defaultUserAgent()})
    if (!icon) throw createError({statusCode: 404, statusMessage: "No usable icon found on the website"})
    const {projects} = await useCollections()
    const updated = await projects.findOneAndUpdate({_id: project._id}, {$set: {icon, updatedAt: new Date()}}, {returnDocument: "after"})
    if (!updated) throw createError({statusCode: 404, statusMessage: "Project not found"})
    invalidateChatProject(project._id)
    return {...updated, permissions: projectPermissions(user, project._id)}
})
