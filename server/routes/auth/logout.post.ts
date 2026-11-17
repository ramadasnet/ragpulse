import logger from "../../utils/logger"

export default defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    await clearUserSession(event)
    if (session.user?.email) logger.info("Auth.logout", session.user.email)
    return {ok: true}
})
