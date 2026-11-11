import { DEFAULT_REFRESH_HOURS, REFRESH_MAX_HOURS, REFRESH_MIN_HOURS } from '#shared/types'
import { EventEmitter } from 'node:events'

/** Emits `kick` whenever a sync is requested, so the scheduler can run immediately. */
export const syncEvents = new EventEmitter()

/**
 * Queues a sync for one source or all URL/git sources of a project.
 * The scheduler (server/plugins/scheduler.ts) picks queued sources up.
 * Returns the number of sources queued.
 */
export async function requestSync(projectId: string, sourceId?: string): Promise<number> {
  const { sources } = await useCollections()
  const filter: Record<string, any> = { projectId, status: { $ne: 'syncing' } }
  if (sourceId) filter._id = sourceId
  const res = await sources.updateMany(filter, { $set: { status: 'queued', nextSyncAt: new Date(0), updatedAt: new Date() } })
  if (res.modifiedCount) syncEvents.emit('kick')
  return res.modifiedCount
}

/** Effective refresh interval (hours) for a source. */
export function sourceRefreshHours(source: { refreshIntervalHours: number | null }, project: { refreshIntervalHours: number }): number {
  const hours = source.refreshIntervalHours ?? project.refreshIntervalHours ?? DEFAULT_REFRESH_HOURS
  return Math.min(REFRESH_MAX_HOURS, Math.max(REFRESH_MIN_HOURS, hours))
}

/**
 * Recomputes `nextSyncAt` for idle sources of a project (call after the project's or a source's refresh interval changes).
 * Sources inheriting the project interval are rescheduled relative to their last sync.
 */
export async function rescheduleProjectSources(projectId: string): Promise<void> {
  const { projects, sources } = await useCollections()
  const project = await projects.findOne({ _id: projectId })
  if (!project) return
  const list = await sources.find({ projectId, status: { $in: ['idle', 'error'] } }).toArray()
  for (const source of list) {
    const base = source.lastSyncAt ? new Date(source.lastSyncAt).getTime() : Date.now()
    const nextSyncAt = new Date(base + sourceRefreshHours(source, project) * 3600_000)
    await sources.updateOne({ _id: source._id }, { $set: { nextSyncAt } })
  }
}
