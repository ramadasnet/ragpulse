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

/** Current admin user (fresh from /api/me) with permission helpers. */
export function useMe() {
    const me = useState<Me | null>("me", () => null)
    const {session} = useUserSession()

    async function refresh() {
        try {
            me.value = await $fetch<Me>("/api/me")
            return "authenticated"
        } catch (error) {
            const status = (error as {statusCode?: number} | null)?.statusCode
            if (status !== 401 && status !== 403) return "unavailable"
            me.value = null
            session.value = null
            return "unauthorized"
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

    return {me, refresh, isAdmin, can, permissionsFor}
}
