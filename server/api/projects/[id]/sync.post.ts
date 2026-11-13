export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    return {queued: await requestSync(project._id)}
})
