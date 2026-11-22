import {afterEach, expect, mock, test} from "bun:test"
import {createQuestion, extractEscalatedQuestion, maybePostEmailFallback, postDueEmailFallbacks} from "../server/utils/questions"
import {ESCALATE_TOKEN, generateAnswer} from "../server/utils/rag"

// The chat page helper imports the `#shared` alias, which only Nuxt resolves
mock.module("#shared/types", () => import("../shared/types/index.ts"))
const {detailsFormMessageId} = await import("../app/utils/chat-theme")

const names = [
    "useCollections",
    "newId",
    "publicUrl",
    "escapeHtml",
    "sendMail",
    "sendEscalationWebhook",
    "hasAiProvider",
    "searchKnowledge",
    "getAppSettings",
    "streamChatCompletion",
    "createQuestion",
    "extractEscalatedQuestion",
    "sessionEnded",
    "getChatProject"
] as const
const original = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
// Push notifications of escalations are fire-and-forget and never throw
Object.assign(globalThis, {notifyProject: async () => {}})

afterEach(() => {
    for (const name of names) {
        const descriptor = original.get(name)
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete (globalThis as any)[name]
    }
})

const WAIT_MINUTES = 5
const project = {_id: "project", title: "Test", supportEmail: "support@example.test", model: "test"} as any
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

/** In-memory sessions, questions and messages, following the filters the email fallback queries use. */
function fakeDb(session: Record<string, any>) {
    const sessions = [{_id: "session", projectId: "project", visitorName: "Visitor", ...session}]
    const questions: any[] = []
    const messages: any[] = []
    const collections = {
        questions: {
            insertOne: async (doc: any) => {
                questions.push(doc)
            },
            updateOne: async () => {},
            findOne: async (filter: any) => {
                if (filter.messageId) return null
                const after = filter.createdAt?.$gt
                const open = questions.filter((q) => q.sessionId === filter.sessionId && q.status === filter.status && (!after || q.createdAt > after))
                return open.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
            },
            // The candidate pipeline of postDueEmailFallbacks
            aggregate: (pipeline: any[]) => ({
                toArray: async () => {
                    const cutoff = pipeline[0].$match.createdAt.$lte
                    const latest = new Map<string, Date>()
                    for (const q of questions) if (q.status === "open" && q.createdAt <= cutoff && !(latest.get(q.sessionId)! >= q.createdAt)) latest.set(q.sessionId, q.createdAt)
                    return sessions.filter((s) => latest.has(s._id) && !s.humanHandledAt && !s.endedAt && (s.emailFallbackAt ?? new Date(0)) < latest.get(s._id)!).map((s) => ({...s}))
                }
            })
        },
        messages: {
            find: () => ({sort: () => ({limit: () => ({toArray: async () => [...messages].reverse()})})}),
            insertOne: async (doc: any) => {
                messages.push(doc)
            }
        },
        sessions: {
            updateOne: async (filter: any, update: any) => {
                const s = sessions.find((x) => x._id === filter._id)
                const claimable = !filter.$or || filter.$or.some((c: any) => (c.emailFallbackAt.$exists === false ? !s?.emailFallbackAt : s?.emailFallbackAt < c.emailFallbackAt.$lt))
                if (!s || (filter.humanHandledAt && s.humanHandledAt) || (filter.endedAt && s.endedAt) || !claimable) return {matchedCount: 0, modifiedCount: 0}
                Object.assign(s, update.$set)
                for (const [key, n] of Object.entries(update.$inc ?? {})) s[key] = (s[key] ?? 0) + (n as number)
                for (const key of Object.keys(update.$unset ?? {})) delete s[key]
                return {matchedCount: 1, modifiedCount: 1}
            }
        }
    }
    let id = 0
    Object.assign(globalThis, {
        useCollections: async () => collections,
        newId: () => `id${++id}`,
        publicUrl: () => "https://example.test/question",
        escapeHtml: (value: string) => value,
        sendMail: async () => false,
        sendEscalationWebhook: async () => {},
        getAppSettings: async () => ({globalInstructions: "", humanTakeoverWaitMinutes: WAIT_MINUTES}),
        sessionEnded: async (s: any) => !!s.endedAt,
        getChatProject: async () => project
    })
    return {sessions, questions, messages, session: sessions[0]!}
}

/** The visitor's question escalated `minutes` ago. */
function escalatedAgo(db: ReturnType<typeof fakeDb>, minutes: number) {
    const at = minutesAgo(minutes)
    db.messages.push({_id: "a1", sessionId: "session", role: "assistant", content: "I've flagged your question for our team.", escalated: true, createdAt: at})
    db.questions.push({_id: "q1", sessionId: "session", messageId: "m1", status: "open", question: "Help", createdAt: at})
}

test("an escalation shows the details form right away, without the email notice", async () => {
    const db = fakeDb({})
    Object.assign(globalThis, {
        searchKnowledge: async () => [],
        hasAiProvider: async () => false,
        createQuestion,
        extractEscalatedQuestion,
        streamChatCompletion: async function* () {
            yield {type: "delta", text: ESCALATE_TOKEN}
        }
    })
    const userMessage = {_id: "m1", sessionId: "session", role: "user", content: "Can I run it on AWS for free?", createdAt: new Date()} as any
    db.messages.push(userMessage)
    const events: any[] = []
    for await (const ev of generateAnswer({project, session: {...db.session, userMessageCount: 1} as any, userMessage})) events.push(ev)

    const escalated = events.at(-1)
    expect(escalated.type).toBe("escalated")
    expect(escalated.message.content).not.toMatch(/email/i)
    expect(detailsFormMessageId(db.messages, db.session)).toBe(escalated.message._id)
    // Before the takeover wait is over, neither polls nor the scheduler post the email notice
    expect(await maybePostEmailFallback(project, db.session as any)).toBe(false)
    expect(await postDueEmailFallbacks()).toBe(0)
    expect(db.messages.some((m) => m.emailFallback)).toBe(false)
})

test("the details form is gone once the visitor shared their name and email", () => {
    const messages = [{_id: "a1", role: "assistant", content: "Flagged.", escalated: true}] as any
    expect(detailsFormMessageId(messages, {visitorName: "Ana", visitorEmail: "ana@example.test"})).toBeUndefined()
    expect(detailsFormMessageId(messages, {visitorName: "Ana"})).toBe("a1")
})

test.each([
    ["is handling the chat", {humanHandledAt: minutesAgo(3)}],
    ["took over and gave the chat back", {emailFallbackAt: minutesAgo(2)}]
])("no email notice when a human %s before the wait was over", async (_, takeover) => {
    const db = fakeDb(takeover)
    escalatedAgo(db, WAIT_MINUTES + 1)
    expect(await postDueEmailFallbacks()).toBe(0)
    expect(await maybePostEmailFallback(project, db.session as any)).toBe(false)
    expect(db.messages.some((m) => m.emailFallback)).toBe(false)
})

test("nobody picks up: the scheduler posts the email notice once after the wait, also for an idle visitor", async () => {
    const db = fakeDb({})
    escalatedAgo(db, WAIT_MINUTES + 1)
    expect(await postDueEmailFallbacks()).toBe(1)
    // Later scheduler ticks and visitor polls don't post it again
    expect(await postDueEmailFallbacks()).toBe(0)
    expect(await maybePostEmailFallback(project, {...db.session} as any)).toBe(false)
    const notices = db.messages.filter((m) => m.emailFallback)
    expect(notices).toHaveLength(1)
    expect(notices[0].content).toContain("we'll get back to you by email soon")
    // The form moves under the notice while the details are still missing
    expect(detailsFormMessageId(db.messages, db.session)).toBe(notices[0]._id)
})

test("no email notice into a chat that already ended", async () => {
    const db = fakeDb({endedAt: minutesAgo(1), endReason: "visitor"})
    escalatedAgo(db, WAIT_MINUTES + 1)
    expect(await postDueEmailFallbacks()).toBe(0)
    expect(db.messages.some((m) => m.emailFallback)).toBe(false)
})
