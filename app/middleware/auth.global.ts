// Protects /admin routes: requires a logged in, enabled user.
export default defineNuxtRouteMiddleware(async (to) => {
    if (!to.path.startsWith("/admin")) return
    const {loggedIn} = useUserSession()
    if (!loggedIn.value) return navigateTo("/login")
    const {me, refresh} = useMe()
    if (!me.value) await refresh()
    if (!me.value) return navigateTo("/login")
})
