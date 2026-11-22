import {afterEach, describe, expect, test} from "bun:test"
import {classifyUserSpecific, createQuestion, extractEscalatedQuestion, replyToQuestion} from "../server/utils/questions"
import {cleanFaqText} from "../server/utils/session-learning"
import {ESCALATE_TOKEN, generateAnswer, toLlmHistory} from "../server/utils/rag"

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
    "extractEscalatedQuestion",
    "chatCompletion",
    "projectModel",
    "cleanFaqText",
    "sessionEnded",
    "indexFaq"
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
        sendEscalationWebhook: async () => {},
        hasAiProvider: async () => false
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
        sendEscalationWebhook: async () => {},
        hasAiProvider: async () => false
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

/** In-memory questions, messages and sessions collections, enough for the escalation paths. */
function fakeDb(messages: any[] = []) {
    const questions: any[] = []
    return {
        questions,
        messages,
        collections: async () => ({
            questions: {
                findOne: async (filter: any) => questions.find((q) => q.messageId === filter.messageId && q.status === filter.status) ?? null,
                insertOne: async (doc: any) => {
                    questions.push(doc)
                },
                updateOne: async () => {}
            },
            messages: {
                // Newest first, like the real query
                find: () => ({sort: () => ({limit: () => ({toArray: async () => [...messages].reverse()})})}),
                insertOne: async (doc: any) => {
                    messages.push(doc)
                }
            },
            sessions: {updateOne: async () => {}}
        })
    }
}

function mockEscalation(db: ReturnType<typeof fakeDb>, extra: Record<string, unknown> = {}) {
    let id = 0
    Object.assign(globalThis, {
        useCollections: db.collections,
        newId: () => `id${++id}`,
        publicUrl: () => "https://example.test/question",
        escapeHtml: (value: string) => value,
        sendMail: async () => false,
        sendEscalationWebhook: async () => {},
        hasAiProvider: async () => false,
        ...extra
    })
}

const project = {_id: "project", title: "Test", supportEmail: "support@example.test", model: "test"} as any
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

test("a new question after the conversation was given back to the agent is escalated as its own question", async () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 18, 18, 0, s))
    // Igor's test: first question escalated, a human replied and gave the chat back without answering the question
    const db = fakeDb([
        {_id: "m1", sessionId: "session", role: "user", content: "What's the maximum database size?", createdAt: at(1)},
        {_id: "a1", sessionId: "session", role: "assistant", content: "I couldn't find a confident answer to that, so I've flagged your question for our team.", escalated: true, createdAt: at(2)},
        {_id: "h1", sessionId: "session", role: "agent", content: "For small projects, 512MB max.", createdAt: at(3)}
    ])
    db.questions.push({_id: "q1", sessionId: "session", messageId: "m1", status: "open", question: "What's the maximum database size?"})
    let llmMessages: any[] = []
    mockEscalation(db, {
        searchKnowledge: async () => [],
        getAppSettings: async () => ({globalInstructions: ""}),
        hasAiProvider: async () => false,
        createQuestion,
        extractEscalatedQuestion,
        streamChatCompletion: async function* (opts: any) {
            llmMessages = opts.messages
            yield {type: "delta", text: ESCALATE_TOKEN}
        }
    })
    const userMessage = {_id: "m2", sessionId: "session", role: "user", content: "Can I run it on AWS for free?", createdAt: at(4)} as any
    db.messages.push(userMessage)
    const events: any[] = []
    for await (const ev of generateAnswer({project, session: {...session, userMessageCount: 2}, userMessage})) events.push(ev)
    expect(llmMessages.slice(1).map((m) => m.content)).toEqual(["What's the maximum database size?", ESCALATE_TOKEN, "(Support team) For small projects, 512MB max.", "Can I run it on AWS for free?"])
    expect(events.at(-1)).toMatchObject({type: "escalated", question: {sessionId: "session", messageId: "m2", status: "open", question: "Can I run it on AWS for free?"}})
    expect(db.questions.map((q) => q.messageId)).toEqual(["m1", "m2"])
})

describe("user-specific questions", () => {
    const decide = (content: string) => ({hasAiProvider: async () => true, projectModel: async () => "test", getAppSettings: async () => ({decisionModel: "jev"}), chatCompletion: async () => ({content})})

    test.each([
        ['{"userSpecific": true}', true],
        ['```json\n{"userSpecific":false}\n```', false],
        ["I am not sure", undefined]
    ])("reads the decision from %p", async (content, expected) => {
        Object.assign(globalThis, decide(content))
        expect(await classifyUserSpecific(project, "Why was my account suspended?")).toBe(expected as boolean | undefined)
    })

    test("asks the decision model, or the project's model when it fails or is not set", async () => {
        const models: string[] = []
        Object.assign(globalThis, {
            ...decide(""),
            chatCompletion: async ({model}: any) => {
                models.push(model)
                if (model === "jev") throw new Error("model not found")
                return {content: '{"userSpecific": true}'}
            }
        })
        expect(await classifyUserSpecific(project, "Why was my account suspended?")).toBe(true)
        expect(models).toEqual(["jev", "test"])
        models.length = 0
        Object.assign(globalThis, {getAppSettings: async () => ({decisionModel: ""})})
        expect(await classifyUserSpecific(project, "Why was my account suspended?")).toBe(true)
        expect(models).toEqual(["test"])
    })

    test("makes no decision without an AI provider", async () => {
        Object.assign(globalThis, {hasAiProvider: async () => false})
        expect(await classifyUserSpecific(project, "Why was my account suspended?")).toBeUndefined()
    })

    test("a new escalated question is tagged in the background", async () => {
        const db = fakeDb()
        const updates: any[] = []
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        mockEscalation(db, {
            ...decide('{"userSpecific": true}'),
            chatCompletion: async () => {
                await gate
                return {content: '{"userSpecific": true}'}
            }
        })
        const collections = await db.collections()
        Object.assign(globalThis, {useCollections: async () => ({...collections, questions: {...collections.questions, updateOne: async (filter: any, update: any) => updates.push([filter, update])}})})
        const question = await createQuestion({project, session, question: "Why was my account suspended?", reason: "user_request", messageId: "m1"})
        expect(question.userSpecific).toBeUndefined()
        release()
        await Bun.sleep(5)
        expect(updates).toEqual([[{_id: question._id}, {$set: {userSpecific: true}, $unset: {classifyingAt: ""}}]])
        expect(question.userSpecific).toBe(true)
    })

    function mockReply(question: any) {
        const faqs: any[] = []
        Object.assign(globalThis, {
            useCollections: async () => ({
                questions: {findOne: async () => question, updateOne: async () => ({modifiedCount: 1}), countDocuments: async () => 0},
                sessions: {findOne: async () => null, updateOne: async () => {}},
                messages: {insertOne: async () => {}},
                projects: {findOne: async () => project},
                faqs: {insertOne: async (doc: any) => faqs.push(doc)}
            }),
            newId: () => "faq",
            sessionEnded: async () => false,
            cleanFaqText,
            indexFaq: async () => {}
        })
        return faqs
    }
    const author = {name: "Support", via: "admin"} as const

    test.each([
        [false, undefined, 1],
        [true, undefined, 0],
        [true, true, 1]
    ])("answering a question with userSpecific=%p and addToFaq=%p adds %p FAQ entries", async (userSpecific, addToFaq, count) => {
        const faqs = mockReply({_id: "q1", projectId: "project", sessionId: "session", question: "Why was my account suspended?", visitorName: "Visitor", status: "open", userSpecific, createdAt: new Date()})
        const result = await replyToQuestion({questionId: "q1", answer: "It was flagged for review.", author, addToFaq, notifyVisitor: false})
        expect(faqs.length).toBe(count)
        expect(!!result.faq).toBe(count > 0)
    })

    test("a reply sent while the classification is pending waits for it before adding to the FAQ", async () => {
        const db = fakeDb()
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        mockEscalation(db, {
            ...decide('{"userSpecific": true}'),
            chatCompletion: async () => {
                await gate
                return {content: '{"userSpecific": true}'}
            }
        })
        const created = await createQuestion({project, session, question: "Why was my account suspended?", reason: "user_request", messageId: "m1"})
        const faqs = mockReply({...created})
        const reply = replyToQuestion({questionId: created._id, answer: "It was flagged for review.", author, notifyVisitor: false})
        release()
        const result = await reply
        expect(faqs.length).toBe(0)
        expect(result.faq).toBeUndefined()
    })

    test("a reply on another server waits for a classification stored as running in the database", async () => {
        const question = {_id: "q1", projectId: "project", sessionId: "session", question: "Why was my account suspended?", visitorName: "Visitor", status: "open", classifyingAt: new Date(), createdAt: new Date()}
        const faqs = mockReply(question)
        const collections = await (globalThis as any).useCollections()
        let reads = 0
        Object.assign(globalThis, {
            useCollections: async () => ({
                ...collections,
                // First read: still classifying (no in-process promise here); later reads: the other server stored its decision
                questions: {...collections.questions, findOne: async () => (reads++ < 2 ? question : {_id: "q1", userSpecific: true})}
            })
        })
        const result = await replyToQuestion({questionId: "q1", answer: "It was flagged for review.", author, notifyVisitor: false})
        expect(reads).toBeGreaterThan(2)
        expect(faqs.length).toBe(0)
        expect(result.faq).toBeUndefined()
    })

    test("a stale classification marker is not waited for", async () => {
        const faqs = mockReply({_id: "q1", projectId: "project", sessionId: "session", question: "How do I reset my password?", visitorName: "Visitor", status: "open", classifyingAt: new Date(Date.now() - 10 * 60_000), createdAt: new Date()})
        const result = await replyToQuestion({questionId: "q1", answer: "Use the reset link.", author, notifyVisitor: false})
        expect(faqs.length).toBe(1)
        expect(result.faq).toBeDefined()
    })
})
