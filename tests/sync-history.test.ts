import { describe, expect, test } from 'bun:test'
import { purgeOldSyncRuns, syncHistoryDays } from '../server/utils/sync-history'

interface Doc { _id: string, startedAt: Date }

/** Minimal in-memory stand-in for the MongoDB collection used by the cleanup. */
function fakeCollection(docs: Doc[]) {
  return {
    docs,
    deleteMany: async (filter: any) => {
      const before = docs.length
      docs.splice(0, docs.length, ...docs.filter(d => !(filter.startedAt?.$lt && d.startedAt < filter.startedAt.$lt)))
      return { deletedCount: before - docs.length }
    }
  }
}

const now = new Date('2026-06-01T00:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600 * 1000)

describe('sync history', () => {
  test('parses the retention period', () => {
    expect(syncHistoryDays(undefined)).toBe(30)
    expect(syncHistoryDays('')).toBe(30)
    expect(syncHistoryDays('abc')).toBe(30)
    expect(syncHistoryDays(0)).toBe(30)
    expect(syncHistoryDays(-5)).toBe(30)
    expect(syncHistoryDays('7')).toBe(7)
    expect(syncHistoryDays(2.5)).toBe(2)
    expect(syncHistoryDays(1000)).toBe(365)
  })

  test('deletes runs older than the cutoff and keeps recent ones', async () => {
    const syncRuns = fakeCollection([
      { _id: 'old', startedAt: daysAgo(45) },
      { _id: 'edge', startedAt: daysAgo(30) },
      { _id: 'recent', startedAt: daysAgo(2) }
    ])
    expect(await purgeOldSyncRuns({ syncRuns } as any, 30, now)).toBe(1)
    expect(syncRuns.docs.map(d => d._id)).toEqual(['edge', 'recent'])
  })

  test('returns 0 for a non-positive retention period', async () => {
    const syncRuns = fakeCollection([{ _id: 'old', startedAt: daysAgo(365) }])
    expect(await purgeOldSyncRuns({ syncRuns } as any, 0, now)).toBe(0)
    expect(syncRuns.docs).toHaveLength(1)
  })
})
