import {expect, test} from "bun:test"
import type {ChatMessage, ChatSession} from "../shared/types"

test("conversation can be given back only during an active takeover with an admin reply", async () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const now = new Date()
    const session: Partial<ChatSession> = {_id: "session", projectId: "project"}
    const messages: Pick<ChatMessage, "role" | "author" | "createdAt">[] = []
    const collection = {
        find: () => ({sort: () => ({limit: () => ({toArray: () => []})})}),
        findOne: ({sessionId, role, "author.via": via, createdAt}: {sessionId: string; role: string; "author.via": string; createdAt: {$gte: Date}}) =>
            sessionId === session._id ? messages.find((m) => m.role === role && m.author?.via === via && m.createdAt >= createdAt.$gte) : undefined
    }
    const overrides = {
        defineEventHandler: (handler: unknown) => handler,
        requireProjectAccess: () => ({project: {_id: "project"}}),
        getRouterParam: () => session._id,
        useCollections: () => ({sessions: {findOne: () => session}, messages: collection, questions: {find: () => ({sort: () => ({toArray: () => []})})}}),
        SESSION_SAFE_PROJECTION: {},
        sessionEnded: () => !!session.endedAt
    }
    const original = Object.entries(overrides).map(([key]) => [key, Object.getOwnPropertyDescriptor(globals, key)] as const)
    try {
        Object.assign(globals, overrides)
        const {default: getConversation} = await import("../server/api/projects/[id]/sessions/[sid]/index.get")
        const read = () => getConversation({} as Parameters<typeof getConversation>[0])

        expect((await read()).canGiveBack).toBe(false)
        session.humanHandledAt = now
        messages.push({role: "agent", author: {name: "Support", via: "admin"}, createdAt: new Date(now.getTime() - 60_000)})
        messages.push({role: "agent", author: {name: "Bot", via: "mcp"}, createdAt: now})
        expect((await read()).canGiveBack).toBe(false)
        // A takeover started before this release stamped humanHandledAt just after saving the reply that started it.
        messages.push({role: "agent", author: {name: "Support", via: "admin"}, createdAt: new Date(now.getTime() - 50)})
        expect(await read()).toMatchObject({canGiveBack: true, messages: []})
        session.endedAt = now
        expect((await read()).canGiveBack).toBe(false)
        delete session.endedAt
        delete session.humanHandledAt
        expect((await read()).canGiveBack).toBe(false)
    } finally {
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globals, key, descriptor)
            else delete globals[key]
        }
    }
})
