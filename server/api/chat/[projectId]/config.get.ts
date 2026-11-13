// Public chat configuration. Fetched cross-origin by embed.js, so it is CORS enabled and not origin restricted.
export default defineEventHandler(async (event) => {
    setResponseHeaders(event, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30",
        Vary: "Origin"
    })
    const project = await requireChatProject(event, {checkOrigin: false})
    return publicChatConfig(project)
})
