import type {Collections} from "./db"
import {releaseHumanHandling} from "./questions"

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

/**
 * Closes chat sessions without messages for more than `days`: their visitor gets a new chat and the team can no longer post into them.
 * @returns Number of closed sessions.
 */
export async function closeInactiveChatSessions(c: Pick<Collections, "sessions">, days: number, now = new Date()): Promise<number> {
    if (!(days > 0)) return 0
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    const result = await c.sessions.updateMany({endedAt: {$exists: false}, lastMessageAt: {$lt: cutoff}}, {$set: {endedAt: now, endReason: "inactive"}})
    return result.modifiedCount
}

/**
 * Deletes escalated questions created more than `retentionDays` ago. FAQ entries created from them are kept.
 * Sessions whose open questions are deleted get their unanswered count and human handoff state reconciled.
 * @returns Number of deleted questions.
 */
export async function purgeOldQuestions(c: Pick<Collections, "questions" | "sessions">, retentionDays: number, now = new Date()): Promise<number> {
    if (!(retentionDays > 0)) return 0
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
    const open = await c.questions.find({createdAt: {$lt: cutoff}, status: "open"}, {projection: {sessionId: 1}}).toArray()
    const result = await c.questions.deleteMany({createdAt: {$lt: cutoff}})
    const removed = new Map<string, number>()
    for (const q of open) removed.set(q.sessionId, (removed.get(q.sessionId) ?? 0) + 1)
    for (const [sessionId, count] of removed) {
        await c.sessions.updateOne({_id: sessionId}, {$inc: {unansweredCount: -count}})
        await releaseHumanHandling(sessionId)
    }
    return result.deletedCount
}
