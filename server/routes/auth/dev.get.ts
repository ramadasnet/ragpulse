// Development-only login shortcut: /auth/dev?email=you@example.com
// Requires a dev build AND NUXT_DEV_LOGIN=true. Never available in production builds.
export default defineEventHandler(async (event) => {
    if (!import.meta.dev || !useRuntimeConfig().devLogin) {
        throw createError({statusCode: 404, statusMessage: "Not found"})
    }
    const email = String(getQuery(event).email || "")
    return loginWithProvider(event, {provider: "dev", providerId: "dev", email, name: email.split("@")[0]})
})
