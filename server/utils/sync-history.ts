import {DEFAULT_SYNC_HISTORY_DAYS, SYNC_HISTORY_MAX_DAYS} from "../../shared/types"
import type {Collections} from "./db"

const DAY_MS = 24 * 3600 * 1000

/** Days sync runs are kept: empty or invalid values use the default, values are clamped to the maximum. */
export function syncHistoryDays(value: unknown): number {
    if (value === "" || value === null || value === undefined) return DEFAULT_SYNC_HISTORY_DAYS
    const days = Number(value)
    if (!Number.isFinite(days)) return DEFAULT_SYNC_HISTORY_DAYS
    const floored = Math.floor(days)
    if (floored < 1) return DEFAULT_SYNC_HISTORY_DAYS
    return Math.min(SYNC_HISTORY_MAX_DAYS, floored)
}

/**
 * Deletes sync runs that started more than `days` ago.
 * @returns Number of deleted runs.
 */
export async function purgeOldSyncRuns(c: Pick<Collections, "syncRuns">, days: number, now = new Date()): Promise<number> {
    if (!(days > 0)) return 0
    const cutoff = new Date(now.getTime() - days * DAY_MS)
    const result = await c.syncRuns.deleteMany({startedAt: {$lt: cutoff}})
    return result.deletedCount
}
