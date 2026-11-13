import {describe, expect, test} from "bun:test"
import {chatSessionRetentionDays, closeInactiveChatSessions, purgeOldChatSessions, purgeOldQuestions} from "../server/utils/chat-retention"

interface Doc {
    _id: string
    sessionId?: string
    lastMessageAt?: Date
    createdAt?: Date
    endedAt?: Date
    endReason?: string
}

/** Minimal in-memory stand-in for the MongoDB collections used by the cleanup. */
function fakeCollection(docs: Doc[]) {
    const matches = (doc: Doc, filter: any) =>
        Object.entries(filter).every(([key, cond]: [string, any]) => {
            const value = (doc as any)[key]
            if (cond?.$lt) return value < cond.$lt
            if (cond?.$exists !== undefined) return (value !== undefined) === cond.$exists
            if (cond?.$in) return cond.$in.includes(value)
            return value === cond
        })
    return {
        docs,
        find: (filter: any) => ({
            limit: (n: number) => ({toArray: async () => docs.filter((d) => matches(d, filter)).slice(0, n)})
        }),
        updateMany: async (filter: any, update: any) => {
            const hits = docs.filter((d) => matches(d, filter))
            for (const d of hits) Object.assign(d, update.$set)
            return {modifiedCount: hits.length}
        },
        deleteMany: async (filter: any) => {
            const before = docs.length
            docs.splice(0, docs.length, ...docs.filter((d) => !matches(d, filter)))
            return {deletedCount: before - docs.length}
        }
    }
}

const now = new Date("2026-06-01T00:00:00Z")
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600 * 1000)

function setup() {
    const sessions = fakeCollection([
        {_id: "old", lastMessageAt: daysAgo(200)},
        {_id: "recent", lastMessageAt: daysAgo(10)}
    ])
    const messages = fakeCollection([
        {_id: "m1", sessionId: "old"},
        {_id: "m2", sessionId: "recent"}
    ])
    const questions = fakeCollection([
        {_id: "q1", sessionId: "old"},
        {_id: "q2", sessionId: "recent"}
    ])
    return {sessions, messages, questions, c: {sessions, messages, questions} as any}
}

describe("chat session retention", () => {
    test("parses the retention period", () => {
        expect(chatSessionRetentionDays(undefined)).toBe(180)
        expect(chatSessionRetentionDays("")).toBe(180)
        expect(chatSessionRetentionDays("abc")).toBe(180)
        expect(chatSessionRetentionDays(-5)).toBe(180)
        expect(chatSessionRetentionDays("30")).toBe(30)
        expect(chatSessionRetentionDays(0)).toBe(0)
    })

    test("deletes inactive sessions with their messages and questions", async () => {
        const {sessions, messages, questions, c} = setup()
        expect(await purgeOldChatSessions(c, 180, now)).toBe(1)
        expect(sessions.docs.map((d) => d._id)).toEqual(["recent"])
        expect(messages.docs.map((d) => d._id)).toEqual(["m2"])
        expect(questions.docs.map((d) => d._id)).toEqual(["q2"])
    })

    test("keeps everything when disabled", async () => {
        const {sessions, c} = setup()
        expect(await purgeOldChatSessions(c, 0, now)).toBe(0)
        expect(sessions.docs).toHaveLength(2)
    })

    test("deletes in batches", async () => {
        const sessions = fakeCollection(Array.from({length: 1201}, (_, i) => ({_id: `s${i}`, lastMessageAt: daysAgo(365)})))
        const c = {sessions, messages: fakeCollection([]), questions: fakeCollection([])} as any
        expect(await purgeOldChatSessions(c, 180, now)).toBe(1201)
        expect(sessions.docs).toHaveLength(0)
    })
})

describe("inactive chat session auto-close", () => {
    test("closes sessions without messages for more than the given days, once", async () => {
        const sessions = fakeCollection([
            {_id: "stale", lastMessageAt: daysAgo(8)},
            {_id: "recent", lastMessageAt: daysAgo(6)},
            {_id: "ended", lastMessageAt: daysAgo(30), endedAt: daysAgo(20), endReason: "visitor"}
        ])
        expect(await closeInactiveChatSessions({sessions} as any, 7, now)).toBe(1)
        expect(sessions.docs.find((d) => d._id === "stale")).toMatchObject({endedAt: now, endReason: "inactive"})
        expect(sessions.docs.find((d) => d._id === "recent")?.endedAt).toBeUndefined()
        expect(sessions.docs.find((d) => d._id === "ended")).toMatchObject({endedAt: daysAgo(20), endReason: "visitor"})
        expect(await closeInactiveChatSessions({sessions} as any, 7, now)).toBe(0)
    })

    test("closes nothing when set to 0", async () => {
        const sessions = fakeCollection([{_id: "stale", lastMessageAt: daysAgo(400)}])
        expect(await closeInactiveChatSessions({sessions} as any, 0, now)).toBe(0)
        expect(sessions.docs[0]?.endedAt).toBeUndefined()
    })
})

describe("escalated question retention", () => {
    test("deletes questions older than the retention period", async () => {
        const questions = fakeCollection([
            {_id: "old", createdAt: daysAgo(400)},
            {_id: "recent", createdAt: daysAgo(30)}
        ])
        expect(await purgeOldQuestions({questions} as any, 365, now)).toBe(1)
        expect(questions.docs.map((d) => d._id)).toEqual(["recent"])
    })

    test("keeps everything when set to 0", async () => {
        const questions = fakeCollection([{_id: "old", createdAt: daysAgo(4000)}])
        expect(await purgeOldQuestions({questions} as any, 0, now)).toBe(0)
        expect(questions.docs).toHaveLength(1)
    })
})
