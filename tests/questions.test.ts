import {afterEach, expect, test} from "bun:test"
import {createQuestion} from "../server/utils/questions"

const names = ["useCollections", "newId", "publicUrl", "escapeHtml", "sendMail", "sendEscalationWebhook"] as const
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
