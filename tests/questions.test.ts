import {afterEach, describe, expect, test} from "bun:test"
import {createQuestion, escalateDuringTakeover} from "../server/utils/questions"
import {ESCALATE_TOKEN, toLlmHistory} from "../server/utils/rag"

const names = ["useCollections", "newId", "publicUrl", "escapeHtml", "sendMail", "sendEscalationWebhook", "hasAiProvider", "chatCompletion"] as const
const original = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))

afterEach(() => {
    for (const name of names) {
        const descriptor = original.get(name)
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete (globalThis as any)[name]
    }
})

test("escalation returns before SMTP completes and records successful delivery afterward", async () => {
    let complete!: (sent: boolean) => void
    const mail = new Promise<boolean>((resolve) => {
        complete = resolve
    })
    const updates: any[] = []
    Object.assign(globalThis, {
        useCollections: async () => ({
            questions: {
                insertOne: async () => {},
                updateOne: async (_: unknown, update: unknown) => {
                    updates.push(update)
                }
            },
            sessions: {updateOne: async () => {}}
        }),
        newId: () => "question",
        publicUrl: () => "https://example.test/question",
        escapeHtml: (value: string) => value,
        sendMail: () => mail,
        sendEscalationWebhook: async () => {}
    })
    const pending = createQuestion({project: {_id: "project", title: "Test", supportEmail: "support@example.test"} as any, session: {_id: "session", visitorName: "Visitor"} as any, question: "Help", reason: "user_request"})
    const result = await Promise.race([pending, Bun.sleep(100).then(() => "blocked")])
    complete(true)
    await pending
    await Bun.sleep(0)
    expect(result).not.toBe("blocked")
    expect(updates).toEqual([{$set: {supportNotifiedAt: expect.any(Date)}}])
})

test.each([false, "reject", "unconfigured"])("escalation remains available when mail is %s", async (outcome) => {
    let calls = 0
    const updates: unknown[] = []
    Object.assign(globalThis, {
        useCollections: async () => ({
            questions: {
                insertOne: async () => {},
                updateOne: async (_: unknown, update: unknown) => {
                    updates.push(update)
                }
            },
            sessions: {updateOne: async () => {}}
        }),
        newId: () => "question",
        publicUrl: () => "https://example.test/question",
        escapeHtml: (value: string) => value,
        sendMail: async () => {
            calls++
            if (outcome === "reject") throw new Error("SMTP failed")
            return false
        },
        sendEscalationWebhook: async () => {}
    })
    const question = await createQuestion({
        project: {_id: "project", title: "Test", supportEmail: outcome === "unconfigured" ? "" : "support@example.test"} as any,
        session: {_id: "session", visitorName: "Visitor"} as any,
        question: "Help",
        reason: "user_request"
    })
    await Bun.sleep(0)
    expect(question._id).toBe("question")
    expect(question.supportNotifiedAt).toBeUndefined()
    expect(updates).toEqual([])
    expect(calls).toBe(outcome === "unconfigured" ? 0 : 1)
})

/** In-memory questions/messages/sessions collections, enough for the escalation paths. */
function fakeDb(messages: any[] = []) {
    const questions: any[] = []
    const cursor = (rows: any[]) => ({sort: () => ({limit: () => ({toArray: async () => rows})})})
    return {
        questions,
        collections: async () => ({
            questions: {
                findOne: async (filter: any) => questions.find((q) => q.messageId === filter.messageId && q.status === filter.status) ?? null,
                find: (filter: any) => cursor(questions.filter((q) => q.sessionId === filter.sessionId && q.status === filter.status)),
                insertOne: async (doc: any) => {
                    questions.push(doc)
                },
                updateOne: async () => {}
            },
            // Newest first, like the real query
            messages: {find: () => cursor([...messages].reverse())},
            sessions: {updateOne: async () => {}}
        })
    }
}

function mockEscalation(db: ReturnType<typeof fakeDb>, extra: Record<string, unknown> = {}) {
    let id = 0
    Object.assign(globalThis, {
        useCollections: db.collections,
        newId: () => `q${++id}`,
        publicUrl: () => "https://example.test/question",
        escapeHtml: (value: string) => value,
        sendMail: async () => false,
        sendEscalationWebhook: async () => {},
        ...extra
    })
}

const project = {_id: "project", title: "Test", supportEmail: ""} as any
const session = {_id: "session", visitorName: "Visitor"} as any

test("a second escalation while the first question is still open gets its own question in the same conversation", async () => {
    const db = fakeDb()
    mockEscalation(db)
    const first = await createQuestion({project, session, question: "What is the max database size?", reason: "low_confidence", messageId: "m1"})
    const second = await createQuestion({project, session, question: "Can I run it on AWS for free?", reason: "low_confidence", messageId: "m2"})
    expect(second._id).not.toBe(first._id)
    expect(db.questions.map((q) => [q.sessionId, q.messageId, q.status])).toEqual([
        ["session", "m1", "open"],
        ["session", "m2", "open"]
    ])
})

describe("escalateDuringTakeover", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 18, 18, 0, s))
    const history = [
        {_id: "m1", role: "user", content: "What is the max database size?", createdAt: at(1)},
        {_id: "a1", role: "assistant", content: "I've flagged your question for our team.", escalated: true, createdAt: at(2)},
        {_id: "h1", role: "agent", content: "Let me check, 1 sec...", createdAt: at(3)},
        {_id: "m2", role: "user", content: "Can I run this on GCP free of charge?", createdAt: at(4)}
    ]
    const latest = history[3] as any

    test("records a new question asked while a human handles the chat", async () => {
        const db = fakeDb(history)
        db.questions.push({_id: "q0", sessionId: "session", messageId: "m1", question: "What is the max database size?", status: "open"})
        let prompt = ""
        mockEscalation(db, {
            hasAiProvider: async () => true,
            chatCompletion: async (opts: any) => {
                prompt = opts.messages[1].content
                return {content: "Can I run this on GCP free of charge?"}
            }
        })
        const question = await escalateDuringTakeover(project, session, latest)
        expect(prompt).toContain("- What is the max database size?")
        expect(prompt).toContain("Visitor: Can I run this on GCP free of charge?")
        expect(question).toMatchObject({sessionId: "session", messageId: "m2", reason: "during_takeover", status: "open", question: "Can I run this on GCP free of charge?"})
        expect(db.questions).toHaveLength(2)
    })

    test("ignores small talk and follow-ups of an open question", async () => {
        const db = fakeDb(history)
        mockEscalation(db, {hasAiProvider: async () => true, chatCompletion: async () => ({content: "NONE"})})
        expect(await escalateDuringTakeover(project, session, latest)).toBeNull()
        expect(db.questions).toHaveLength(0)
    })

    test("never throws when the AI call fails", async () => {
        const db = fakeDb(history)
        mockEscalation(db, {
            hasAiProvider: async () => true,
            chatCompletion: async () => {
                throw new Error("timeout")
            }
        })
        expect(await escalateDuringTakeover(project, session, latest)).toBeNull()
    })
})

test("earlier escalations reach the model as the escalation token, not as the apology the visitor saw", () => {
    const at = new Date()
    const history = toLlmHistory([
        {_id: "m1", role: "user", content: "Max database size?", createdAt: at},
        {_id: "a1", role: "assistant", content: "I couldn't find a confident answer to that, so I've flagged your question.", escalated: true, createdAt: at},
        {_id: "f1", role: "assistant", content: "Our team hasn't picked up the chat yet.", emailFallback: true, createdAt: at},
        {_id: "h1", role: "agent", content: "512MB max.", createdAt: at}
    ] as any)
    expect(history).toEqual([
        {role: "user", content: "Max database size?"},
        {role: "assistant", content: ESCALATE_TOKEN},
        {role: "assistant", content: "(Support team) 512MB max."}
    ])
})
