import logger from "../../utils/logger"

export default defineOAuthGoogleEventHandler({
    config: {scope: ["openid", "email", "profile"]},
    async onSuccess(event, {user}) {
        if (user.email_verified === false) return sendRedirect(asH3Event(event), "/login?error=unverified")
        return loginWithProvider(event, {
            provider: "google",
            providerId: String(user.sub),
            email: user.email,
            name: user.name,
            avatar: user.picture
        })
    },
    onError(event, error) {
        logger.error("Auth.google", "OAuth error", error)
        return sendRedirect(asH3Event(event), "/login?error=oauth")
    }
})
