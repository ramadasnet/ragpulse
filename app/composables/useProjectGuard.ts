import type { ProjectPermission } from '#shared/types'

const PROJECT_PAGES: Array<{ path: string, perm: ProjectPermission }> = [
  { path: '', perm: 'analytics:read' },
  { path: '/conversations', perm: 'sessions:read' },
  { path: '/questions', perm: 'questions:reply' },
  { path: '/knowledge', perm: 'sources:manage' },
  { path: '/settings', perm: 'settings:edit' }
]

/**
 * Ensures the current user has `perm` on the project; otherwise redirects to the first
 * project page they can access (or the projects list). Returns true when allowed.
 */
export async function guardProjectPage(projectId: string, perm: ProjectPermission): Promise<boolean> {
  const { can } = useMe()
  if (can(projectId, perm)) return true
  const first = PROJECT_PAGES.find(p => can(projectId, p.perm))
  await navigateTo(first ? `/admin/projects/${projectId}${first.path}` : '/admin', { replace: true })
  return false
}
