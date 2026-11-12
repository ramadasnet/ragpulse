// Source synchronisation: fetch → markdown → chunks → embeddings → MongoDB.
import {projectIngestDetail, type Chunk, type DocumentRecord, type IngestDetail, type Source, type SyncRun} from "#shared/types"
import {chunkMarkdown, type MarkdownChunk} from "./chunker"
import {createCodeSummarizer} from "./code-summary"
import {CHUNK_PRESETS, dedupeAcrossDocuments, refineMarkdown} from "./detail"
import {createBinaryExtractor} from "./extract"
import {fetchDriveSource, parseServiceAccountKey} from "./drive"
import {fetchGitSource, scrubGitSecrets} from "./git"
import type {FetchContext, FetchOutcome, FetchedDocument} from "./types"
import {fetchUrlSource} from "./url"

const SYNC_TIMEOUT_MS = 30 * 60_000
/** Flush pending documents once this many chunks wait for embeddings */
const EMBED_BATCH = 128
/** Incomplete syncs (rate limited crawl, deferred code summaries) run again after at most this many hours */
const INCOMPLETE_RETRY_HOURS = 1

export interface SyncResult {
    sourceId: string
    ok: boolean
    documents: number
    chunks: number
    changed: number
    removed: number
    embedded: number
    error?: string
}

interface PendingDoc {
    doc: FetchedDocument
    hash: string
    prevId?: string
    chunks: MarkdownChunk[]
}

async function fetchSource(source: Source, ctx: FetchContext): Promise<FetchOutcome> {
    if (source.type === "git") return fetchGitSource(source.url, source.options || {}, ctx)
    if (source.type === "drive") {
        const raw = source.options?.serviceAccountKey || useRuntimeConfig().googleServiceAccountKey
        if (!raw) throw new Error("No Google service account key configured (NUXT_GOOGLE_SERVICE_ACCOUNT_KEY)")
        return fetchDriveSource(source.url, {serviceAccountKey: parseServiceAccountKey(raw)}, ctx)
    }
    return fetchUrlSource(source.url, {crawl: source.options?.crawl, maxPages: source.options?.maxPages}, ctx)
}

/** Content hash of a document; the preset is part of it, so changing the preset re-chunks every document. */
function documentHash(markdown: string, detail: IngestDetail): string {
    return sha256(detail === "balanced" ? markdown : `${detail}\0${markdown}`)
}

/**
 * Fingerprint of everything besides the content that shapes a source's index (preset, options, models). Credentials are
 * left out, so rotating a token doesn't force a full sync.
 */
function revisionSalt(source: Source, detail: IngestDetail, codeSummaryModel: string): string {
    const {accessToken: _token, serviceAccountKey: _key, ...options} = source.options || {}
    const visionModel = String(useRuntimeConfig().visionModel || "")
    return sha256(JSON.stringify({detail, options, codeSummaryModel, visionModel})).slice(0, 16)
}

function errorText(err: any, source: Source): string {
    const raw = String(err?.statusMessage || err?.message || err || "Unknown error")
    return scrubGitSecrets(raw, [source.options?.accessToken]).replace(/\s+/g, " ").trim().slice(0, 500)
}

/** Records a sync run in the source's history. History must never break a sync. */
async function recordSyncRun(run: Omit<SyncRun, "_id">): Promise<void> {
    try {
        const {syncRuns} = await useCollections()
        await syncRuns.insertOne({...run, _id: newId()})
    } catch (err: any) {
        console.warn(`[ingest] could not record sync run: ${err?.message || err}`)
    }
}

/** Removes all documents, chunks and history of a source. */
export async function deleteSourceData(sourceId: string): Promise<void> {
    const {documents, chunks, syncRuns} = await useCollections()
    await Promise.all([documents.deleteMany({sourceId}), chunks.deleteMany({sourceId, sourceType: {$ne: "faq"}}), syncRuns.deleteMany({sourceId})])
}

/** Syncs one source now. Never throws: failures are stored on the source (existing knowledge is kept). */
export async function syncSource(sourceId: string): Promise<SyncResult> {
    const {sources, projects, documents, chunks} = await useCollections()
    const result: SyncResult = {sourceId, ok: false, documents: 0, chunks: 0, changed: 0, removed: 0, embedded: 0}
    const startedAt = Date.now()

    const source = await sources.findOneAndUpdate({_id: sourceId, status: {$ne: "syncing"}}, {$set: {status: "syncing", updatedAt: new Date()}}, {returnDocument: "after"})
    if (!source) {
        result.error = "Source not found or already syncing"
        return result
    }
    const project = await projects.findOne({_id: source.projectId})
    const refreshHours = sourceRefreshHours(source, project ?? {refreshIntervalHours: 48})
    const label = `"${source.title}" (${source.type})`

    try {
        if (!project) throw new Error("Project not found")
        const settings = await getAppSettings({fresh: true})
        const detail = projectIngestDetail(project)
        const signal = AbortSignal.timeout(SYNC_TIMEOUT_MS)
        const log = (msg: string) => console.info(`[ingest] ${label}: ${msg}`)
        const existing = (await documents.find({sourceId}, {projection: {_id: 1, ref: 1, hash: 1, title: 1, url: 1, version: 1}}).toArray()) as Array<
            Pick<DocumentRecord, "_id" | "ref" | "hash" | "title" | "url" | "version">
        >
        const byRef = new Map(existing.map((d) => [d.ref, d]))
        const outcome = await fetchSource(source, {
            userAgent: settings.userAgent || defaultUserAgent(),
            detail,
            requestIntervalMs: settings.requestIntervalMs,
            signal,
            log,
            extractBinary: createBinaryExtractor(detail),
            summarizeCode: createCodeSummarizer(settings.codeSummaryModel, {detail, maxPerSync: Number(useRuntimeConfig().codeSummaryMaxPerSync) || 0, signal, log}),
            knownVersions: new Map(existing.flatMap((d) => (d.version ? [[d.ref, d.version] as const] : []))),
            knownRevision: existing.length ? source.syncedRevision : undefined,
            revisionSalt: revisionSalt(source, detail, settings.codeSummaryModel)
        })
        // Unchanged since the last complete sync: every stored document is kept as is
        if (outcome.upToDate) outcome.unchanged = existing.map((d) => d.ref)

        if (!outcome.documents.length && !outcome.unchanged?.length) {
            const reason = outcome.errors[0] || outcome.skipped[0]?.reason
            throw new Error(
                source.type === "git"
                    ? `No indexable files found${reason ? ` (${reason})` : " — check the include patterns and branch"}`
                    : source.type === "drive"
                      ? `No indexable files found${reason ? ` (${reason})` : ""}`
                      : `No indexable content${reason ? ` (${reason})` : ""}`
            )
        }

        const refined = outcome.documents.map((doc) => ({...doc, markdown: refineMarkdown(doc.markdown, detail)}))
        const fetched = detail === "detailed" ? refined : dedupeAcrossDocuments(refined, detail === "compact" ? "similar" : "exact")
        const chunkOptions = CHUNK_PRESETS[detail]

        const embeddingModel = embeddingKey(settings)
        const embeddingDimensions = settings.embeddingDimensionsParam ? settings.embeddingDimensions : undefined

        let pending: PendingDoc[] = []
        let pendingChunks = 0

        const flush = async () => {
            if (!pending.length) return
            const batch = pending
            pending = []
            pendingChunks = 0

            // Reuse embeddings of identical chunks already stored in this project (same model)
            const hashes = [...new Set(batch.flatMap((p) => p.chunks.map((c) => c.hash)))]
            const vectors = new Map<string, number[]>()
            if (hashes.length) {
                const reusable = chunks.find({projectId: source.projectId, hash: {$in: hashes}, embeddingModel}, {projection: {hash: 1, embedding: 1}})
                for await (const c of reusable as AsyncIterable<Pick<Chunk, "hash" | "embedding">>) {
                    if (Array.isArray(c.embedding) && c.embedding.length) vectors.set(c.hash, c.embedding)
                }
            }
            const missing: Array<{hash: string; content: string}> = []
            const queued = new Set<string>()
            for (const p of batch) {
                for (const c of p.chunks) {
                    if (!vectors.has(c.hash) && !queued.has(c.hash)) {
                        queued.add(c.hash)
                        missing.push({hash: c.hash, content: c.content})
                    }
                }
            }
            if (missing.length) {
                const {embeddings} = await createEmbeddings(
                    missing.map((m) => m.content),
                    {model: settings.embeddingModel, dimensions: embeddingDimensions}
                )
                missing.forEach((m, i) => {
                    if (embeddings[i]) vectors.set(m.hash, embeddings[i]!)
                })
                result.embedded += missing.length
            }

            const now = new Date()
            for (const p of batch) {
                const docId = p.prevId ?? newId()
                const usable = p.chunks.filter((c) => vectors.has(c.hash))
                const newChunks: Chunk[] = usable.map((c) => ({
                    _id: newId(),
                    projectId: source.projectId,
                    sourceId: source._id,
                    documentId: docId,
                    sourceType: source.type,
                    title: p.doc.title,
                    ...(p.doc.url ? {url: p.doc.url} : {}),
                    ...(c.heading ? {heading: c.heading} : {}),
                    content: c.content,
                    hash: c.hash,
                    embedding: vectors.get(c.hash)!,
                    embeddingModel,
                    tokens: c.tokens,
                    createdAt: now
                }))
                if (newChunks.length) await chunks.insertMany(newChunks, {ordered: false})
                await chunks.deleteMany({documentId: docId, _id: {$nin: newChunks.map((c) => c._id)}})
                const unset: Record<string, ""> = {}
                if (!p.doc.url) unset.url = ""
                if (!p.doc.version) unset.version = ""
                await documents.updateOne(
                    {sourceId: source._id, ref: p.doc.ref},
                    {
                        $set: {
                            projectId: source.projectId,
                            title: p.doc.title,
                            ...(p.doc.url ? {url: p.doc.url} : {}),
                            hash: p.hash,
                            markdown: p.doc.markdown,
                            ...(p.doc.version ? {version: p.doc.version} : {}),
                            chunkCount: newChunks.length,
                            updatedAt: now
                        },
                        $setOnInsert: {_id: docId, sourceId: source._id, ref: p.doc.ref},
                        ...(Object.keys(unset).length ? {$unset: unset} : {})
                    },
                    {upsert: true}
                )
                result.changed++
            }
        }

        for (const doc of fetched) {
            const hash = documentHash(doc.markdown, detail)
            const prev = byRef.get(doc.ref)
            if (prev && prev.hash === hash) {
                if (prev.title !== doc.title || (prev.url || "") !== (doc.url || "")) {
                    const update = doc.url ? {$set: {title: doc.title, url: doc.url}} : {$set: {title: doc.title}, $unset: {url: "" as const}}
                    await documents.updateOne({_id: prev._id}, update)
                    await chunks.updateMany({documentId: prev._id}, update)
                }
                if ((prev.version || "") !== (doc.version || "")) {
                    await documents.updateOne({_id: prev._id}, doc.version ? {$set: {version: doc.version}} : {$unset: {version: "" as const}})
                }
                continue
            }
            const docChunks = chunkMarkdown(doc.markdown, {...chunkOptions, title: doc.title})
            pending.push({doc, hash, prevId: prev?._id, chunks: docChunks})
            pendingChunks += docChunks.length
            if (pendingChunks >= EMBED_BATCH) await flush()
        }
        await flush()

        // Documents that disappeared from the source (transient failures and incomplete fetches keep their previous version)
        const keep = new Set([...fetched.map((d) => d.ref), ...outcome.failedRefs, ...(outcome.unchanged ?? [])])
        const gone = outcome.incomplete ? [] : existing.filter((d) => !keep.has(d.ref)).map((d) => d._id)
        if (gone.length) {
            await chunks.deleteMany({documentId: {$in: gone}})
            await documents.deleteMany({_id: {$in: gone}})
            result.removed = gone.length
        }

        // The source may have been deleted while we were syncing
        if (!(await sources.findOne({_id: sourceId}, {projection: {_id: 1}}))) {
            await deleteSourceData(sourceId)
            result.error = "Source deleted during sync"
            return result
        }

        const [totals, chunkCount] = await Promise.all([
            documents
                .aggregate<{count: number; bytes: number}>([
                    {$match: {sourceId}},
                    {$group: {_id: null, count: {$sum: 1}, bytes: {$sum: {$strLenBytes: {$ifNull: ["$markdown", ""]}}}}}
                ])
                .toArray()
                .then((rows) => rows[0] ?? {count: 0, bytes: 0}),
            chunks.countDocuments({sourceId, sourceType: source.type})
        ])
        const documentCount = totals.count
        const warnings = [outcome.incomplete, outcome.failedRefs.length ? `${outcome.failedRefs.length} item(s) could not be fetched and kept their previous version: ${outcome.errors[0] ?? ""}`.trim() : ""].filter(Boolean)
        const partial = warnings.length ? warnings.join(" · ").slice(0, 500) : undefined
        const message = partial ? scrubGitSecrets(partial, [source.options?.accessToken]) : undefined
        const nextHours = outcome.incomplete ? Math.min(INCOMPLETE_RETRY_HOURS, refreshHours) : refreshHours
        const durationMs = Date.now() - startedAt
        // Only a complete sync may be skipped next time
        const revision = message ? undefined : outcome.revision
        const unset: Record<string, ""> = revision ? {} : {syncedRevision: ""}
        if (!message) unset.lastError = ""
        await sources.updateOne(
            {_id: sourceId},
            {
                $set: {
                    status: "idle",
                    lastSyncAt: new Date(),
                    lastDurationMs: durationMs,
                    documentCount,
                    chunkCount,
                    nextSyncAt: nextSyncDate(Date.now(), nextHours),
                    updatedAt: new Date(),
                    ...(message ? {lastError: message} : {}),
                    ...(revision ? {syncedRevision: revision} : {})
                },
                $unset: unset
            }
        )
        await recordSyncRun({
            projectId: source.projectId,
            sourceId,
            status: message ? "partial" : "success",
            startedAt: new Date(startedAt),
            finishedAt: new Date(),
            durationMs,
            documents: documentCount,
            bytes: totals.bytes,
            chunks: chunkCount,
            changed: result.changed,
            removed: result.removed,
            embedded: result.embedded,
            ...(message ? {message} : {})
        })
        Object.assign(result, {ok: true, documents: documentCount, chunks: chunkCount})
        if (outcome.upToDate) console.info(`[ingest] ${label} unchanged since the last sync, ${documentCount} docs kept`)
        else console.info(`[ingest] ${label} synced in ${(durationMs / 1000).toFixed(1)}s: ${documentCount} docs (${result.changed} changed, ${result.removed} removed), ${chunkCount} chunks, ${result.embedded} embedded`)
        return result
    } catch (err: any) {
        const message = errorText(err, source)
        result.error = message
        console.warn(`[ingest] ${label} failed: ${message}`)
        // Manual only sources are not retried automatically
        const retryHours = Math.min(1, refreshHours)
        await sources
            .updateOne(
                {_id: sourceId},
                {
                    $set: {
                        status: "error",
                        lastError: message,
                        lastDurationMs: Date.now() - startedAt,
                        nextSyncAt: nextSyncDate(Date.now(), retryHours),
                        updatedAt: new Date()
                    },
                    // A failed sync may have updated only part of the documents: the next one must not be skipped
                    $unset: {syncedRevision: ""}
                }
            )
            .catch(() => {})
        await recordSyncRun({
            projectId: source.projectId,
            sourceId,
            status: "failed",
            startedAt: new Date(startedAt),
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt,
            changed: result.changed,
            removed: result.removed,
            embedded: result.embedded,
            message
        })
        return result
    }
}

/** Re-queues sources left in `syncing` by a crashed/restarted instance. */
export async function resetStuckSyncs(): Promise<number> {
    const {sources} = await useCollections()
    const res = await sources.updateMany({status: "syncing"}, {$set: {status: "queued", nextSyncAt: new Date(), updatedAt: new Date()}})
    return res.modifiedCount
}

/** Syncs sources that are due (queued or past `nextSyncAt`). Returns the results. */
export async function runDueSyncs(opts: {limit?: number; concurrency?: number} = {}): Promise<SyncResult[]> {
    const {sources} = await useCollections()
    const due = await sources
        .find({status: {$in: ["queued", "idle", "error"]}, nextSyncAt: {$lte: new Date()}}, {projection: {_id: 1}})
        .sort({nextSyncAt: 1})
        .limit(opts.limit ?? 20)
        .toArray()
    const ids = due.map((d) => d._id)
    const results: SyncResult[] = []
    const worker = async () => {
        while (ids.length) {
            const id = ids.shift()!
            results.push(await syncSource(id))
        }
    }
    await Promise.all(Array.from({length: Math.max(1, opts.concurrency ?? 2)}, worker))
    return results
}
