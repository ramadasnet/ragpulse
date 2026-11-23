import {describe, expect, mock, test} from "bun:test"
import type {ChatMessage, Project} from "../shared/types"

mock.module("#shared/types", () => import("../shared/types/index.ts"))
mock.module("#shared/utils/instructions", () => import("../shared/utils/instructions.ts"))
mock.module("#shared/utils/webhook", () => import("../shared/utils/webhook.ts"))

const {publicChatMessage} = await import("../server/utils/chat-public")
const {buildProjectUpdate, projectUpdateSchema} = await import("../server/utils/projects")

const reply: ChatMessage = {
    _id: "reply",
    projectId: "project",
    sessionId: "session",
    role: "agent",
    content: "How can I help?",
    author: {userId: "private-id", name: "Sam", via: "admin"},
    createdAt: new Date()
}

describe("support display names", () => {
    test("defaults to Support Team for existing projects and empty custom names", () => {
        expect(publicChatMessage(reply, {}).supportName).toBe("Support Team")
        expect(publicChatMessage(reply, {supportDisplayName: {useAdminName: false, customName: ""}}).supportName).toBe("Support Team")
    })

    test("uses the validated project setting without exposing the reply's author metadata", () => {
        const patch = projectUpdateSchema.parse({supportDisplayName: {useAdminName: false, customName: "  Customer Care  "}})
        const {$set} = buildProjectUpdate({} as Project, patch)
        expect($set.supportDisplayName).toEqual({useAdminName: false, customName: "Customer Care"})
        const publicReply = publicChatMessage(reply, $set)
        expect(publicReply.supportName).toBe("Customer Care")
        expect(publicReply).not.toHaveProperty("author")
    })

    test("uses each replying admin's name when enabled, with a fallback for other replies", () => {
        const project = {supportDisplayName: {useAdminName: true, customName: "Customer Care"}}
        expect(publicChatMessage(reply, project).supportName).toBe("Sam")
        expect(publicChatMessage({...reply, author: {name: "Avery", via: "admin"}}, project).supportName).toBe("Avery")
        expect(publicChatMessage({...reply, author: undefined}, project).supportName).toBe("Customer Care")
        expect(publicChatMessage({...reply, author: {name: "Private bot name", via: "mcp"}}, project).supportName).toBe("Customer Care")
        expect(publicChatMessage({...reply, role: "assistant"}, project).supportName).toBeUndefined()
    })
})
