import type {ChatSession} from "#shared/types"

export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sessions:read")
    const query = getQuery(event)
    const limit = Math.min(200, Math.max(1, Math.floor(Number(query.limit) || 50)))
    const filter: Record<string, any> = {projectId: project._id}

    if (query.before) {
        const before = new Date(String(query.before))
        if (Number.isNaN(before.getTime())) throw createError({statusCode: 400, statusMessage: "Invalid `before` cursor"})
        filter.lastMessageAt = {$lt: before}
    }
    const q = String(query.q || "")
        .trim()
        .slice(0, 100)
    if (q) {
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        filter.$or = [{visitorName: regex}, {visitorEmail: regex}]
    }

    const {sessions} = await useCollections()
    const items = (await sessions.find(filter, {projection: SESSION_SAFE_PROJECTION}).sort({lastMessageAt: -1}).limit(limit).toArray()) as Array<Omit<ChatSession, "tokenHash" | "ipHash">>

    const last = items[items.length - 1]
    return {
        items,
        nextBefore: items.length === limit && last ? new Date(last.lastMessageAt).toISOString() : undefined
    }
})
