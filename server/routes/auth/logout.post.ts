import logger from "../../utils/logger"

export default defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    await clearUserSession(event)
    const sessionId = session.secure?.sessionId
    if (sessionId) {
        // The cookie is cleared either way; without the revocation only a renewal racing this logout could restore it
        await revokeSession(sessionId).catch((err) => logger.warn("Auth.logout", session.user?.email, "Could not revoke the session", err))
    }
    if (session.user?.email) logger.info("Auth.logout", session.user.email)
    return {ok: true}
})
