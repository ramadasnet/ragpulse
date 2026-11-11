import type { Project, ProjectPermission } from '#shared/types'

export interface ProjectSummary extends Project {
  permissions: ProjectPermission[]
  stats: { sources: number, faqs: number, chunks: number, sessions7d: number, openQuestions: number }
}

/** Projects visible to the current user (shared state used by the sidebar and pages). */
export function useProjects() {
  const projects = useState<ProjectSummary[]>('projects', () => [])
  const loaded = useState<boolean>('projects-loaded', () => false)

  async function refresh() {
    projects.value = await $fetch<ProjectSummary[]>('/api/projects')
    loaded.value = true
    return projects.value
  }

  async function ensure() {
    if (!loaded.value) await refresh().catch(() => {})
  }

  return { projects, loaded, refresh, ensure }
}

/** Current project id from the route (`/admin/projects/:id/...`). */
export function useProjectId() {
  const route = useRoute()
  return computed(() => (route.params.id as string | undefined) || undefined)
}
