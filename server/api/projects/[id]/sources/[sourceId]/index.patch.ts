import type { Source } from '#shared/types'
import { parseDriveFolderId } from '#shared/utils/drive'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectAccess(event, 'sources:manage')
  const sourceId = getRouterParam(event, 'sourceId')
  const { sources } = await useCollections()
  const source = await sources.findOne({ _id: sourceId, projectId: project._id })
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Source not found' })

  const body = await readIngestBody(event, sourcePatchSchema)
  const set: Partial<Source> = { updatedAt: new Date() }
  if (body.url !== undefined) set.url = validateSourceUrl(source.type, body.url)
  if (body.options !== undefined) set.options = buildSourceOptions(source.type, body.options, source.options)

  // Drive: re-validate folder access when the url or the key changed, and use the folder name as default title
  let driveFolderName: string | undefined
  if (source.type === 'drive' && ((set.url !== undefined && set.url !== source.url) || (set.options !== undefined && set.options.serviceAccountKey !== source.options.serviceAccountKey))) {
    const raw = (set.options ?? source.options).serviceAccountKey || useRuntimeConfig().googleServiceAccountKey
    if (!raw) throw createError({ statusCode: 400, statusMessage: 'No Google service account key configured (NUXT_GOOGLE_SERVICE_ACCOUNT_KEY)' })
    try {
      const folder = await getDriveFolder(parseDriveFolderId(set.url ?? source.url)!, parseServiceAccountKey(raw))
      driveFolderName = folder.name
    }
    catch (err: any) {
      throw createError({ statusCode: 400, statusMessage: String(err?.message || 'Could not access the Google Drive folder') })
    }
  }
  if (body.title !== undefined) {
    set.title = body.title || driveFolderName || (source.type === 'drive' ? source.title : defaultSourceTitle(source.type, body.url ?? source.url))
  }

  const contentChanged = (set.url !== undefined && set.url !== source.url)
    || (set.options !== undefined && JSON.stringify(set.options) !== JSON.stringify(source.options))
  const updated: Source = { ...source, ...set }
  if (body.refreshIntervalHours !== undefined) {
    updated.refreshIntervalHours = set.refreshIntervalHours = body.refreshIntervalHours
    if (source.status === 'idle' || source.status === 'error') {
      const base = source.lastSyncAt ? new Date(source.lastSyncAt).getTime() : Date.now()
      updated.nextSyncAt = set.nextSyncAt = new Date(base + sourceRefreshHours(updated, project) * 3600_000)
    }
  }
  if (contentChanged && source.status !== 'syncing') {
    updated.status = set.status = 'queued'
    updated.nextSyncAt = set.nextSyncAt = new Date(0)
  }

  await sources.updateOne({ _id: source._id }, { $set: set })
  if (updated.status === 'queued') syncEvents.emit('kick')
  return serializeSource(updated)
})
