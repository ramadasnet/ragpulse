import type {ProjectAccess, ProjectPermission, Role} from "#shared/types"
import {PROJECT_PERMISSIONS} from "#shared/types"

export interface Me {
    _id: string
    email: string
    name: string
    avatar?: string
    role: Role
    projects: ProjectAccess[]
}

// Sign-out bookkeeping (client only): a /api/me call that was already running when sign-out
// started must neither set `me` again nor have its renewed session cookie arrive after logout cleared it.
let generation = 0
let signingOut = false
const pending = new Set<Promise<unknown>>()

/** Current admin user (fresh from /api/me) with permission helpers. */
export function useMe() {
    const me = useState<Me | null>("me", () => null)
    const {session} = useUserSession()

    async function refresh() {
        if (signingOut) return "unauthorized"
        const started = generation
        const request = $fetch<Me>("/api/me")
        pending.add(request)
        try {
            const user = await request
            if (started !== generation) return "unauthorized"
            me.value = user
            return "authenticated"
        } catch (error) {
            if (started !== generation) return "unauthorized"
            const status = (error as {statusCode?: number} | null)?.statusCode
            if (status !== 401 && status !== 403) return "unavailable"
            me.value = null
            session.value = null
            return "unauthorized"
        } finally {
            pending.delete(request)
        }
    }

    /**
     * Ends the session. Responses to refreshes already in flight are ignored, and logout is sent
     * only after they settle, so a renewed cookie from one of them cannot land after logout's.
     */
    async function signOut(beforeLogout?: () => Promise<unknown>) {
        generation++
        signingOut = true
        try {
            await Promise.allSettled(pending)
            await beforeLogout?.()
            await $fetch("/auth/logout", {method: "POST"})
            me.value = null
            session.value = null
        } finally {
            signingOut = false
        }
    }

    const isAdmin = computed(() => me.value?.role === "admin")

    function can(projectId: string | undefined, permission?: ProjectPermission): boolean {
        if (!me.value || !projectId) return false
        if (me.value.role === "admin") return true
        const access = me.value.projects.find((p) => p.projectId === projectId)
        if (!access) return false
        return !permission || access.permissions.includes(permission)
    }

    function permissionsFor(projectId: string): ProjectPermission[] {
        if (me.value?.role === "admin") return [...PROJECT_PERMISSIONS]
        return me.value?.projects.find((p) => p.projectId === projectId)?.permissions ?? []
    }

    return {me, refresh, signOut, isAdmin, can, permissionsFor}
}
