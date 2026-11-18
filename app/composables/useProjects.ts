import type {Project, ProjectPermission} from "#shared/types"

export interface ProjectSummary extends Project {
    permissions: ProjectPermission[]
    stats: {sources: number; faqs: number; chunks: number; sessions7d: number; openQuestions: number}
}

/** Projects visible to the current user (shared state used by the sidebar and pages). */
export function useProjects() {
    const projects = useState<ProjectSummary[]>("projects", () => [])
    const loaded = useState<boolean>("projects-loaded", () => false)

    async function refresh() {
        projects.value = await $fetch<ProjectSummary[]>("/api/projects")
        loaded.value = true
        return projects.value
    }

    async function ensure() {
        if (!loaded.value) await refresh().catch(() => {})
    }

    /** Sets the open question count of a project (the sidebar badge) without reloading every project summary. */
    function setOpenQuestions(projectId: string, open: number) {
        const project = projects.value.find((p) => p._id === projectId)
        if (project) project.stats.openQuestions = open
    }

    /** Reloads the open question count of a project. */
    async function refreshOpenQuestions(projectId: string) {
        const counts = await $fetch<{open: number}>(`/api/projects/${projectId}/questions/counts`)
        setOpenQuestions(projectId, counts.open)
    }

    return {projects, loaded, refresh, ensure, setOpenQuestions, refreshOpenQuestions}
}

/** Current project id from the route (`/admin/projects/:id/...`). */
export function useProjectId() {
    const route = useRoute()
    return computed(() => (route.params.id as string | undefined) || undefined)
}
