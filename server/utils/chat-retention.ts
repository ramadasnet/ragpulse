import type {Collections} from "./db"

export const DEFAULT_CHAT_SESSION_RETENTION_DAYS = 180
const DAY_MS = 24 * 3600 * 1000
const BATCH_SIZE = 500

/** Retention period in days from config: empty or invalid values use the default, 0 disables the cleanup. */
export function chatSessionRetentionDays(value: unknown): number {
    if (value === "" || value === null || value === undefined) return DEFAULT_CHAT_SESSION_RETENTION_DAYS
    const days = Number(value)
    return Number.isFinite(days) && days >= 0 ? days : DEFAULT_CHAT_SESSION_RETENTION_DAYS
}

/**
 * Deletes chat sessions without activity for more than `retentionDays`, with their messages and questions.
 * @returns Number of deleted sessions.
 */
export async function purgeOldChatSessions(c: Pick<Collections, "sessions" | "messages" | "questions">, retentionDays: number, now = new Date()): Promise<number> {
    if (!(retentionDays > 0)) return 0
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
    let deleted = 0
    while (true) {
        const batch = await c.sessions
            .find({lastMessageAt: {$lt: cutoff}}, {projection: {_id: 1}})
            .limit(BATCH_SIZE)
            .toArray()
        if (!batch.length) return deleted
        const ids = batch.map((s) => s._id)
        // Children first, so an interrupted run leaves no orphans behind
        await Promise.all([c.messages.deleteMany({sessionId: {$in: ids}}), c.questions.deleteMany({sessionId: {$in: ids}})])
        const result = await c.sessions.deleteMany({_id: {$in: ids}})
        deleted += result.deletedCount
        if (batch.length < BATCH_SIZE) return deleted
    }
}
