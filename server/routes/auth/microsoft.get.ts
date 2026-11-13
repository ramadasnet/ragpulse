import logger from "../../utils/logger"

export default defineOAuthMicrosoftEventHandler({
    config: {scope: ["User.Read", "openid", "email", "profile"]},
    async onSuccess(event, {user}) {
        return loginWithProvider(event, {
            provider: "microsoft",
            providerId: String(user.id),
            email: user.mail || user.userPrincipalName,
            name: user.displayName
        })
    },
    onError(event, error) {
        logger.error("Auth.microsoft", "OAuth error", error)
        return sendRedirect(asH3Event(event), "/login?error=oauth")
    }
})
