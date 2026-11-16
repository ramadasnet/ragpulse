export default defineEventHandler(async (event) => {
    const {user, project} = await requireProjectAccess(event)
    return {...projectForUser(user, project), permissions: projectPermissions(user, project._id)}
})
