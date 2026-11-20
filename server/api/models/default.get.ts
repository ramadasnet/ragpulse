/** The default chat model of the Global Settings, for the model pickers of the projects. */
export default defineEventHandler(async (event) => {
    await requireUser(event)
    return {model: (await getAppSettings()).defaultModel}
})
