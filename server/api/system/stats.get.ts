import type {Db} from "mongodb"

const COLLECTIONS = ["projects", "sources", "faqs", "documents", "chunks", "sessions", "messages", "questions", "users", "apiTokens", "syncRuns", "locks", "extractions", "settings"] as const

interface CollectionStat {
    name: string
    count: number
    size: number
    storageSize: number
    indexSize: number
    avgObjSize: number
}

async function collectionStats(db: Db, name: string): Promise<CollectionStat> {
    const empty: CollectionStat = {name, count: 0, size: 0, storageSize: 0, indexSize: 0, avgObjSize: 0}
    try {
        const [row] = await db
            .collection(name)
            .aggregate<any>([{$collStats: {storageStats: {}}}])
            .toArray()
        const s = row?.storageStats
        if (s) {
            return {name, count: Number(s.count || 0), size: Number(s.size || 0), storageSize: Number(s.storageSize || 0), indexSize: Number(s.totalIndexSize || 0), avgObjSize: Number(s.avgObjSize || 0)}
        }
    } catch {
        // $collStats unsupported (or collection missing): fall back to the legacy command
    }
    try {
        const s: any = await db.command({collStats: name})
        return {name, count: Number(s.count || 0), size: Number(s.size || 0), storageSize: Number(s.storageSize || 0), indexSize: Number(s.totalIndexSize || 0), avgObjSize: Number(s.avgObjSize || 0)}
    } catch {
        try {
            return {...empty, count: await db.collection(name).estimatedDocumentCount()}
        } catch {
            return empty
        }
    }
}

async function countPerProject(db: Db, name: string): Promise<Map<string, number>> {
    try {
        const rows = await db
            .collection(name)
            .aggregate<{_id: string; n: number}>([{$group: {_id: "$projectId", n: {$sum: 1}}}])
            .toArray()
        return new Map(rows.map((r) => [String(r._id), r.n]))
    } catch {
        return new Map()
    }
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event)
    const db = await useDb()
    const config = useRuntimeConfig()
    const {projects, sources} = await useCollections()

    const [settings, embedding, dbStats, collections, projectList, chunks, documents, sessions, messages, schedulerRows, nextDue] = await Promise.all([
        getAppSettings(),
        embeddingStatus(),
        db.stats().catch(() => null),
        Promise.all(COLLECTIONS.map((name) => collectionStats(db, name))),
        projects
            .find({}, {projection: {_id: 1, title: 1}})
            .sort({createdAt: 1})
            .toArray(),
        countPerProject(db, "chunks"),
        countPerProject(db, "documents"),
        countPerProject(db, "sessions"),
        countPerProject(db, "messages"),
        sources
            .aggregate<{_id: string; n: number}>([{$group: {_id: "$status", n: {$sum: 1}}}])
            .toArray()
            .catch(() => []),
        sources
            .find({status: "idle", nextSyncAt: {$lt: MANUAL_NEXT_SYNC}}, {projection: {nextSyncAt: 1}})
            .sort({nextSyncAt: 1})
            .limit(1)
            .toArray()
            .catch(() => [])
    ])

    const avg = (name: string) => collections.find((c) => c.name === name)?.avgObjSize ?? 0
    const perProject = projectList
        .map((p) => {
            const row = {
                projectId: p._id,
                title: p.title,
                chunks: chunks.get(p._id) ?? 0,
                documents: documents.get(p._id) ?? 0,
                sessions: sessions.get(p._id) ?? 0,
                messages: messages.get(p._id) ?? 0
            }
            // Rough data size estimate from average document sizes
            const estimatedBytes = Math.round(row.chunks * avg("chunks") + row.documents * avg("documents") + row.sessions * avg("sessions") + row.messages * avg("messages"))
            return {...row, estimatedBytes}
        })
        .sort((a, b) => b.estimatedBytes - a.estimatedBytes)

    const status = new Map(schedulerRows.map((r) => [r._id, r.n]))
    const oauth: any = config.oauth || {}
    let googleDrive: string | null = null
    try {
        googleDrive = config.googleServiceAccountKey ? parseServiceAccountKey(config.googleServiceAccountKey).client_email : null
    } catch {}

    return {
        db: {
            name: db.databaseName,
            dataSize: Number(dbStats?.dataSize || 0),
            storageSize: Number(dbStats?.storageSize || 0),
            indexSize: Number(dbStats?.indexSize || 0),
            collections: Number(dbStats?.collections || 0),
            objects: Number(dbStats?.objects || 0)
        },
        collections: collections.map(({avgObjSize: _avg, ...c}) => c),
        vectorMode: getVectorMode(),
        embeddingModel: settings.embeddingModel,
        embeddingDimensions: settings.embeddingDimensions,
        embedding,
        perProject,
        config: {
            openrouter: !!config.openrouterApiKey,
            smtp: isMailConfigured(),
            google: !!(oauth.google?.clientId && oauth.google?.clientSecret),
            microsoft: !!(oauth.microsoft?.clientId && oauth.microsoft?.clientSecret),
            googleDrive,
            adminUrl: String(config.public.adminUrl || ""),
            chatUrl: String(config.public.chatUrl || "")
        },
        scheduler: {
            queued: status.get("queued") ?? 0,
            syncing: status.get("syncing") ?? 0,
            errors: status.get("error") ?? 0,
            idle: status.get("idle") ?? 0,
            nextDue: nextDue[0]?.nextSyncAt ? new Date(nextDue[0].nextSyncAt).toISOString() : undefined
        }
    }
})
