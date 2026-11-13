import {describe, expect, test} from "bun:test"
import {MANUAL_NEXT_SYNC, nextSyncDate, sourceRefreshHours} from "../server/utils/sync-queue"

describe("refresh intervals", () => {
    test("manual only sources are never due, others follow the source or project interval", () => {
        expect(sourceRefreshHours({refreshIntervalHours: 0}, {refreshIntervalHours: 48})).toBe(0)
        expect(sourceRefreshHours({refreshIntervalHours: null}, {refreshIntervalHours: 0})).toBe(0)
        expect(sourceRefreshHours({refreshIntervalHours: 336}, {refreshIntervalHours: 0})).toBe(336)
        expect(nextSyncDate(1000, 0)).toBe(MANUAL_NEXT_SYNC)
        expect(nextSyncDate(1000, 2).getTime()).toBe(1000 + 2 * 3600_000)
    })
})
