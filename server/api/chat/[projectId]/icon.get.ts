// Project icon for the chat page, decoded from the stored data URI so it can be cached by the browser.
export default defineEventHandler(async (event) => {
    const project = await requireChatProject(event, {checkOrigin: false})
    const match = project.icon?.match(/^data:([\w/+.-]+);base64,(.+)$/)
    if (!match) throw createError({statusCode: 404, statusMessage: "No icon"})
    setResponseHeaders(event, {
        "Content-Type": match[1]!,
        "Cache-Control": "public, max-age=86400",
        // SVG icons must never run scripts when opened directly
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff"
    })
    return Buffer.from(match[2]!, "base64")
})
