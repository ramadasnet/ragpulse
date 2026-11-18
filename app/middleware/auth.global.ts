// Protects /admin routes: requires a logged in, enabled user.
export default defineNuxtRouteMiddleware(async (to) => {
    if (!to.path.startsWith("/admin")) return
    // The page asked for is restored after signing in (links in emails open a specific question)
    const login = {path: "/login", query: to.fullPath === "/admin" ? {} : {redirect: to.fullPath}}
    const {loggedIn} = useUserSession()
    if (!loggedIn.value) return navigateTo(login)
    const {me, refresh} = useMe()
    if (!me.value) await refresh()
    if (!me.value) return navigateTo(login)
})
