// Security headers for the chat page (/chat/:projectId): only the project's website and allowed domains
// (plus this app and the admin instance, for the appearance preview) may embed it in an iframe.
const CHAT_PAGE_RE = /^\/chat\/([\w-]{1,64})\/?$/

export default defineEventHandler(async (event) => {
    const match = getRequestPath(event).split("?")[0]!.match(CHAT_PAGE_RE)
    if (!match) return
    const project = await getChatProject(match[1]!)
    const preview = getQuery(event).preview === "1"
    if (!project || (!project.enabled && !preview)) {
        throw createError({statusCode: 404, statusMessage: "Chat not found"})
    }
    const adminOrigin = urlOrigin(useRuntimeConfig(event).public.adminUrl)
    const ancestors = ["'self'", adminOrigin, ...frameAncestors(project)].filter(Boolean)
    removeResponseHeader(event, "X-Frame-Options")
    setResponseHeaders(event, {
        "Content-Security-Policy": `frame-ancestors ${ancestors.join(" ")}`,
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff"
    })
})
