import type {ProjectPermission} from "#shared/types"

const PROJECT_PAGES: Array<{path: string; perm: ProjectPermission}> = [
    {path: "", perm: "analytics:read"},
    {path: "/conversations", perm: "sessions:read"},
    {path: "/questions", perm: "questions:reply"},
    {path: "/knowledge", perm: "sources:manage"},
    {path: "/settings", perm: "settings:edit"}
]

/**
 * Checks project permissions and redirects users who lack access, after their account is loaded.
 */
export async function guardProjectPage(projectId: string, perm: ProjectPermission): Promise<boolean> {
    const {me, can} = useMe()
    if (!me.value) return false
    if (can(projectId, perm)) return true
    const first = PROJECT_PAGES.find((p) => can(projectId, p.perm))
    await navigateTo(first ? `/admin/projects/${projectId}${first.path}` : "/admin", {replace: true})
    return false
}
