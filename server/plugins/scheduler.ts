// Scheduler: periodically syncs sources that are due, and immediately when a sync is requested.
// Re-embeds stored chunks after an embedding model change.
// Also deletes chat sessions older than the configured retention period and old sync history.
// MongoDB locks make sure only one instance runs each job at a time.
const LOCK_NAME = 'scheduler'
const RETENTION_LOCK_NAME = 'chat-retention'
const HISTORY_LOCK_NAME = 'sync-history-retention'
const RETENTION_INTERVAL_MS = 3600 * 1000
const LOCK_TTL_SECONDS = 120
const MAX_PER_TICK = 20
const REEMBED_BUDGET_MS = 90_000

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return

  const instanceId = `${process.pid}-${newId(8)}`
  const config = useRuntimeConfig()
  const tickMs = Math.max(10, Number(config.syncTickSeconds) || 60) * 1000
  const retentionDays = chatSessionRetentionDays(config.chatSessionRetentionDays)
  let running = false
  let rerun = false
  let closed = false
  let kickTimer: ReturnType<typeof setTimeout> | null = null

  async function withLock<T>(fn: () => Promise<T>, name = LOCK_NAME): Promise<T | undefined> {
    if (!(await acquireLock(name, instanceId, LOCK_TTL_SECONDS))) return undefined
    const renew = setInterval(() => {
      acquireLock(name, instanceId, LOCK_TTL_SECONDS).catch(() => {})
    }, (LOCK_TTL_SECONDS / 3) * 1000)
    try {
      return await fn()
    }
    finally {
      clearInterval(renew)
      await releaseLock(name, instanceId).catch(() => {})
    }
  }

  async function purgeChatSessions() {
    if (closed || !retentionDays) return
    try {
      const deleted = await withLock(async () => purgeOldChatSessions(await useCollections(), retentionDays), RETENTION_LOCK_NAME)
      if (deleted) console.info(`[scheduler] deleted ${deleted} chat session(s) older than ${retentionDays} day(s)`)
    }
    catch (err: any) {
      console.error(`[scheduler] chat session cleanup failed: ${err?.message || err}`)
    }
  }

  async function purgeSyncHistory() {
    if (closed) return
    try {
      const days = (await getAppSettings()).syncHistoryDays
      const deleted = await withLock(async () => purgeOldSyncRuns(await useCollections(), days), HISTORY_LOCK_NAME)
      if (deleted) console.info(`[scheduler] deleted ${deleted} sync run(s) older than ${days} day(s)`)
    }
    catch (err: any) {
      console.error(`[scheduler] sync history cleanup failed: ${err?.message || err}`)
    }
  }

  async function runRetention() {
    await purgeChatSessions()
    await purgeSyncHistory()
  }

  async function tick() {
    if (closed) return
    if (running) {
      rerun = true
      return
    }
    running = true
    let more = false
    try {
      const ran = await withLock(async () => {
        const synced = await runDueSyncs({ limit: MAX_PER_TICK, concurrency: 2 })
        // After an embedding model change, stored chunks are re-embedded in the background
        const reembed = await reembedStaleChunks({ timeBudgetMs: REEMBED_BUDGET_MS }).catch((err: any) => {
          console.error(`[scheduler] re-embedding failed: ${err?.statusMessage || err?.message || err}`)
          return { updated: 0, remaining: false }
        })
        return { synced, reembed }
      })
      const results = ran?.synced
      if (results?.length) {
        const failed = results.filter(r => !r.ok).length
        console.info(`[scheduler] synced ${results.length} source(s)${failed ? `, ${failed} failed` : ''}`)
        more = results.length >= MAX_PER_TICK
      }
      if (ran?.reembed.updated) console.info(`[scheduler] re-embedded ${ran.reembed.updated} chunk(s)${ran.reembed.remaining ? ', continuing' : ', done'}`)
      if (ran?.reembed.remaining) more = true
    }
    catch (err: any) {
      console.error(`[scheduler] tick failed: ${err?.message || err}`)
    }
    finally {
      running = false
      if (rerun || more) {
        rerun = false
        kick()
      }
    }
  }

  function kick() {
    if (closed) return
    if (kickTimer) clearTimeout(kickTimer)
    kickTimer = setTimeout(() => {
      kickTimer = null
      tick()
    }, 1000)
  }

  const startup = setTimeout(async () => {
    try {
      // If we can take the lock nobody is syncing, so `syncing` sources are leftovers of a crash/restart
      const reset = await withLock(() => resetStuckSyncs())
      if (reset) console.info(`[scheduler] re-queued ${reset} interrupted sync(s)`)
    }
    catch (err: any) {
      console.error(`[scheduler] startup failed: ${err?.message || err}`)
    }
    tick()
    runRetention()
  }, 3000)

  const interval = setInterval(tick, tickMs)
  const retentionInterval = setInterval(runRetention, RETENTION_INTERVAL_MS)
  syncEvents.on('kick', kick)

  nitroApp.hooks.hook('close', () => {
    closed = true
    clearTimeout(startup)
    clearInterval(interval)
    clearInterval(retentionInterval)
    if (kickTimer) clearTimeout(kickTimer)
    syncEvents.off('kick', kick)
  })
})
