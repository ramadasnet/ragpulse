import type {AppSettings, ChatSession, ProjectPermission, Question, Source, SyncRun, User} from "#shared/types"
import {accessibleProjectIds, hasProjectPermission} from "./auth"
import type {Collections} from "./db"
import {effectiveSessionEnd} from "./mcp/sessions"

const RECENT_LIMIT = 5
const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 7

/** A bounded activity feed and totals, scoped to the permissions of each underlying project view. */
export async function getDashboard(user: User, db: Pick<Collections, "projects" | "questions" | "sessions" | "syncRuns" | "sources">, settings: Pick<AppSettings, "chatAutoCloseDays" | "syncHistoryDays">) {
    const visibleIds = accessibleProjectIds(user)
    const projects = await db.projects
        .find(visibleIds === null ? {} : {_id: {$in: visibleIds}})
        .project<{_id: string; title: string; enabled: boolean}>({_id: 1, title: 1, enabled: 1})
        .toArray()
    const scope = (permission: ProjectPermission) => projects.filter((p) => hasProjectPermission(user, p._id, permission)).map((p) => p._id)
    const questionIds = scope("questions:reply")
    const sessionIds = scope("sessions:read")
    const syncIds = scope("sources:manage")
    const now = Date.now()
    const since = new Date(now - WINDOW_DAYS * DAY_MS)
    // Failed runs older than the sync history retention are already deleted, so the window can't be longer than it
    const syncWindowDays = Math.min(WINDOW_DAYS, settings.syncHistoryDays)
    const syncSince = new Date(now - syncWindowDays * DAY_MS)
    // Chats past the inactivity auto-close are ended even before the hourly cleanup flags them
    const activeSince = settings.chatAutoCloseDays ? {lastMessageAt: {$gte: new Date(now - settings.chatAutoCloseDays * DAY_MS)}} : {}
    const openFilter = {projectId: {$in: questionIds}, status: "open" as const}
    const sessionFilter = {projectId: {$in: sessionIds}}
    const syncFilter = {projectId: {$in: syncIds}}

    const [questions, openQuestions, conversations, conversations7d, humanHandled, syncs, failedSyncs7d] = await Promise.all([
        questionIds.length ? db.questions.find(openFilter).sort({createdAt: -1}).limit(RECENT_LIMIT).project<Pick<Question, "_id" | "projectId" | "question" | "createdAt">>({_id: 1, projectId: 1, question: 1, createdAt: 1}).toArray() : [],
        questionIds.length ? db.questions.countDocuments(openFilter) : 0,
        sessionIds.length
            ? db.sessions
                  .find(sessionFilter)
                  .sort({lastMessageAt: -1})
                  .limit(RECENT_LIMIT)
                  .project<Pick<ChatSession, "_id" | "projectId" | "visitorName" | "lastMessageAt" | "humanHandledAt" | "finishedAt" | "endedAt" | "endReason">>({
                      _id: 1,
                      projectId: 1,
                      visitorName: 1,
                      lastMessageAt: 1,
                      humanHandledAt: 1,
                      finishedAt: 1,
                      endedAt: 1,
                      endReason: 1
                  })
                  .toArray()
            : [],
        sessionIds.length ? db.sessions.countDocuments({...sessionFilter, createdAt: {$gte: since}}) : 0,
        sessionIds.length ? db.sessions.countDocuments({...sessionFilter, humanHandledAt: {$type: "date"}, finishedAt: {$exists: false}, endedAt: {$exists: false}, ...activeSince}) : 0,
        syncIds.length
            ? db.syncRuns.find(syncFilter).sort({startedAt: -1}).limit(RECENT_LIMIT).project<Pick<SyncRun, "_id" | "projectId" | "sourceId" | "status" | "startedAt">>({_id: 1, projectId: 1, sourceId: 1, status: 1, startedAt: 1}).toArray()
            : [],
        syncIds.length ? db.syncRuns.countDocuments({...syncFilter, status: "failed", startedAt: {$gte: syncSince}}) : 0
    ])
    const sources = syncs.length
        ? await db.sources
              .find({...syncFilter, _id: {$in: [...new Set(syncs.map((run) => run.sourceId))]}})
              .project<Pick<Source, "_id" | "projectId" | "title">>({_id: 1, projectId: 1, title: 1})
              .toArray()
        : []
    const sourceById = new Map(sources.map((source) => [source._id, source]))
    const titleById = new Map(projects.map((project) => [project._id, project.title]))

    return {
        projects: {total: projects.length, enabled: projects.filter((p) => p.enabled).length},
        questions: questionIds.length ? {total: openQuestions, items: questions.map((item) => ({...item, projectTitle: titleById.get(item.projectId)}))} : null,
        conversations: sessionIds.length
            ? {started7d: conversations7d, humanHandled, items: conversations.map((item) => ({...item, endedAt: effectiveSessionEnd(item, settings.chatAutoCloseDays).endedAt, projectTitle: titleById.get(item.projectId)}))}
            : null,
        syncs: syncIds.length
            ? {
                  failed7d: failedSyncs7d,
                  windowDays: syncWindowDays,
                  items: syncs.flatMap((item) => {
                      const source = sourceById.get(item.sourceId)
                      return source?.projectId === item.projectId ? [{...item, title: source.title, projectTitle: titleById.get(item.projectId)}] : []
                  })
              }
            : null
    }
}
