export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    await setUserSession(event, {secure: {lastActiveAt: Date.now()}})
    setResponseHeader(event, "Cache-Control", "no-store")
    return serializeUser(user)
})
