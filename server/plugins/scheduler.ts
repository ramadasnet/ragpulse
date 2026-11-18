// Scheduler: periodically syncs sources that are due, and immediately when a sync is requested.
// Re-embeds stored chunks after an embedding model change.
// Also closes chat sessions without messages for the configured number of days, deletes chat sessions older than the configured retention period, old escalated questions and old sync history,
// sends the delayed answer emails of visitors who did not see the answer in the chat,
// and posts the "answer comes by email" notice into escalated chats nobody took over in time.
// MongoDB locks make sure only one instance runs each job at a time.
import logger from "../utils/logger"

const LOCK_NAME = "scheduler"
const RETENTION_LOCK_NAME = "chat-retention"
const HISTORY_LOCK_NAME = "sync-history-retention"
const QUESTION_LOCK_NAME = "question-retention"
const AUTO_CLOSE_LOCK_NAME = "chat-auto-close"
const EMAIL_LOCK_NAME = "answer-emails"
const FALLBACK_LOCK_NAME = "email-fallbacks"
const EMAIL_INTERVAL_MS = 30_000
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
        const renew = setInterval(
            () => {
                acquireLock(name, instanceId, LOCK_TTL_SECONDS).catch(() => {})
            },
            (LOCK_TTL_SECONDS / 3) * 1000
        )
        try {
            return await fn()
        } finally {
            clearInterval(renew)
            await releaseLock(name, instanceId).catch(() => {})
        }
    }

    async function purgeChatSessions() {
        if (closed || !retentionDays) return
        try {
            const deleted = await withLock(async () => purgeOldChatSessions(await useCollections(), retentionDays), RETENTION_LOCK_NAME)
            if (deleted) logger.info("Scheduler.retention", `Deleted ${deleted} chat session(s) older than ${retentionDays} day(s)`)
        } catch (err: any) {
            logger.error("Scheduler.retention", "Chat session cleanup failed", err)
        }
    }

    async function purgeSyncHistory() {
        if (closed) return
        try {
            const days = (await getAppSettings()).syncHistoryDays
            const deleted = await withLock(async () => purgeOldSyncRuns(await useCollections(), days), HISTORY_LOCK_NAME)
            if (deleted) logger.info("Scheduler.retention", `Deleted ${deleted} sync run(s) older than ${days} day(s)`)
        } catch (err: any) {
            logger.error("Scheduler.retention", "Sync history cleanup failed", err)
        }
    }

    async function purgeQuestions() {
        if (closed) return
        try {
            const days = (await getAppSettings()).questionRetentionDays
            if (!days) return
            const deleted = await withLock(async () => purgeOldQuestions(await useCollections(), days), QUESTION_LOCK_NAME)
            if (deleted) logger.info("Scheduler.retention", `Deleted ${deleted} escalated question(s) older than ${days} day(s)`)
        } catch (err: any) {
            logger.error("Scheduler.retention", "Escalated question cleanup failed", err)
        }
    }

    async function closeInactiveSessions() {
        if (closed) return
        try {
            const days = (await getAppSettings()).chatAutoCloseDays
            if (!days) return
            const count = await withLock(async () => closeInactiveChatSessions(await useCollections(), days), AUTO_CLOSE_LOCK_NAME)
            if (count) logger.info("Scheduler.retention", `Closed ${count} chat session(s) without messages for ${days} day(s)`)
        } catch (err: any) {
            logger.error("Scheduler.retention", "Closing inactive chat sessions failed", err)
        }
    }

    async function sendAnswerEmails() {
        if (closed) return
        try {
            const res = await withLock(() => sendDueAnswerEmails(), EMAIL_LOCK_NAME)
            if (res?.sent || res?.skipped || res?.failed) logger.info("Scheduler.emails", `Answer emails: ${res.sent} sent, ${res.skipped} skipped (seen in the chat), ${res.failed} failed`)
        } catch (err: any) {
            logger.error("Scheduler.emails", "Answer emails failed", err)
        }
    }

    async function postEmailFallbacks() {
        if (closed) return
        try {
            const posted = await withLock(() => postDueEmailFallbacks(), FALLBACK_LOCK_NAME)
            if (posted) logger.info("Scheduler.emails", `Posted ${posted} email fallback notice(s) into chats nobody took over`)
        } catch (err: any) {
            logger.error("Scheduler.emails", "Email fallback notices failed", err)
        }
    }

    async function runRetention() {
        await closeInactiveSessions()
        await purgeChatSessions()
        await purgeQuestions()
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
                const synced = await runDueSyncs({limit: MAX_PER_TICK, concurrency: 2})
                // After an embedding model change, stored chunks are re-embedded in the background
                const reembed = await reembedStaleChunks({timeBudgetMs: REEMBED_BUDGET_MS}).catch((err: any) => {
                    logger.error("Scheduler.tick", "Re-embedding failed", err)
                    return {updated: 0, remaining: false}
                })
                return {synced, reembed}
            })
            const results = ran?.synced
            if (results?.length) {
                const failed = results.filter((r) => !r.ok).length
                logger.info("Scheduler.tick", `Synced ${results.length} source(s)${failed ? `, ${failed} failed` : ""}`)
                more = results.length >= MAX_PER_TICK
            }
            if (ran?.reembed.updated) logger.info("Scheduler.tick", `Re-embedded ${ran.reembed.updated} chunk(s)${ran.reembed.remaining ? ", continuing" : ", done"}`)
            if (ran?.reembed.remaining) more = true
        } catch (err: any) {
            logger.error("Scheduler.tick", "Tick failed", err)
        } finally {
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
            if (reset) logger.info("Scheduler.startup", `Re-queued ${reset} interrupted sync(s)`)
        } catch (err: any) {
            logger.error("Scheduler.startup", "Startup failed", err)
        }
        tick()
        runRetention()
    }, 3000)

    const interval = setInterval(tick, tickMs)
    const retentionInterval = setInterval(runRetention, RETENTION_INTERVAL_MS)
    const emailInterval = setInterval(() => {
        sendAnswerEmails()
        postEmailFallbacks()
    }, EMAIL_INTERVAL_MS)
    syncEvents.on("kick", kick)

    nitroApp.hooks.hook("close", () => {
        closed = true
        clearTimeout(startup)
        clearInterval(interval)
        clearInterval(retentionInterval)
        clearInterval(emailInterval)
        if (kickTimer) clearTimeout(kickTimer)
        syncEvents.off("kick", kick)
    })
})
