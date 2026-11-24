import {expect, mock, test} from "bun:test"
import type {User} from "../shared/types"
import {getDashboard} from "../server/utils/dashboard"

function collection(rows: Record<string, unknown>[] = []) {
    const countDocuments = mock(async (_filter: unknown) => rows.length)
    const cursor = {
        sort: mock((_order: unknown) => cursor),
        limit: mock((_size: number) => cursor),
        project: mock((_projection: unknown) => cursor),
        toArray: async () => rows
    }
    return {find: mock((_filter: unknown) => cursor), countDocuments, cursor}
}

test("dashboard scopes each activity feed and its totals to the matching project permission", async () => {
    const user = {
        role: "assistant",
        projects: [
            {projectId: "support", permissions: ["questions:reply"]},
            {projectId: "chat", permissions: ["sessions:read"]},
            {projectId: "docs", permissions: ["sources:manage"]},
            {projectId: "deleted", permissions: ["questions:reply"]}
        ]
    } as User
    const db = {
        projects: collection([
            {_id: "support", title: "Support", enabled: true},
            {_id: "chat", title: "Chat", enabled: true},
            {_id: "docs", title: "Docs", enabled: false}
        ]),
        questions: collection([{_id: "q", projectId: "support", question: "Can you help?"}]),
        sessions: collection([{_id: "c", projectId: "chat", visitorName: "Visitor"}]),
        syncRuns: collection([
            {_id: "r", projectId: "docs", sourceId: "docs-1", status: "failed"},
            {_id: "removed", projectId: "docs", sourceId: "removed-source", status: "success"}
        ]),
        sources: collection([{_id: "docs-1", projectId: "docs", title: "Help center"}])
    }
    const dashboard = await getDashboard(user, db as unknown as Parameters<typeof getDashboard>[1])

    expect(db.projects.find).toHaveBeenCalledWith({_id: {$in: ["support", "chat", "docs", "deleted"]}})
    const open = {projectId: {$in: ["support"]}, status: "open"}
    expect(db.questions.find).toHaveBeenCalledWith(open)
    expect(db.questions.countDocuments).toHaveBeenCalledWith(open)
    expect(db.sessions.find).toHaveBeenCalledWith({projectId: {$in: ["chat"]}})
    expect(db.sessions.countDocuments.mock.calls).toEqual([[{projectId: {$in: ["chat"]}, createdAt: {$gte: expect.any(Date)}}], [{projectId: {$in: ["chat"]}, humanHandledAt: {$type: "date"}, finishedAt: {$exists: false}, endedAt: {$exists: false}}]])
    expect(db.syncRuns.find).toHaveBeenCalledWith({projectId: {$in: ["docs"]}})
    expect(db.syncRuns.countDocuments).toHaveBeenCalledWith({projectId: {$in: ["docs"]}, status: "failed", startedAt: {$gte: expect.any(Date)}})
    expect(db.questions.cursor.limit).toHaveBeenCalledWith(5)
    expect(db.sessions.cursor.limit).toHaveBeenCalledWith(5)
    expect(db.syncRuns.cursor.limit).toHaveBeenCalledWith(5)
    expect(dashboard.projects).toEqual({total: 3, enabled: 2})
    expect(dashboard.questions?.items[0]?.projectTitle).toBe("Support")
    expect(dashboard.conversations?.items[0]?.projectTitle).toBe("Chat")
    expect(dashboard.syncs?.items).toEqual([{_id: "r", projectId: "docs", sourceId: "docs-1", status: "failed", title: "Help center", projectTitle: "Docs"}])
})

test("dashboard does not query activity when an assistant lacks the matching permissions", async () => {
    const db = {
        projects: collection([{_id: "p", title: "Project", enabled: true}]),
        questions: collection(),
        sessions: collection(),
        syncRuns: collection(),
        sources: collection()
    }
    const user = {role: "assistant", projects: [{projectId: "p", permissions: ["settings:edit"]}]} as User
    expect(await getDashboard(user, db as unknown as Parameters<typeof getDashboard>[1])).toEqual({
        projects: {total: 1, enabled: 1},
        questions: null,
        conversations: null,
        syncs: null
    })
    for (const activity of [db.questions, db.sessions, db.syncRuns, db.sources]) {
        expect(activity.find).not.toHaveBeenCalled()
        expect(activity.countDocuments).not.toHaveBeenCalled()
    }
})
