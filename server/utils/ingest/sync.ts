// Source synchronisation: fetch → markdown → chunks → embeddings → MongoDB.
import {DEFAULT_REFRESH_HOURS, projectIngestDetail, type Chunk, type DocumentRecord, type IngestDetail, type Source, type SyncRun} from "#shared/types"
import {chunkMarkdown, type MarkdownChunk} from "./chunker"
import {createCodeSummarizer} from "./code-summary"
import {CHUNK_PRESETS, createStreamingDeduper, dedupeAcrossDocuments, refineMarkdown} from "./detail"
import {createBinaryExtractor} from "./extract"
import {fetchDriveSource, parseServiceAccountKey} from "./drive"
import {fetchGitSource, scrubGitSecrets} from "./git"
import {HostThrottle} from "./throttle"
import type {FetchContext, FetchOutcome, FetchedDocument} from "./types"
import {DEFAULT_REQUEST_INTERVAL_MS, fetchUrlSource} from "./url"
import logger from "../logger"

const SYNC_TIMEOUT_MS = 30 * 60_000
/** Flush pending documents once this many chunks wait for embeddings (matches embedding batch size, keeps RAM low) */
const EMBED_BATCH = 64
/** Incomplete syncs (rate limited crawl, deferred code summaries, embedding backoff) run again after at most this many hours */
const INCOMPLETE_RETRY_HOURS = 1
/** Process-wide per-host throttle shared across concurrent syncs and retries (bounded to 500 hosts, 30 min TTL) */
const sharedUrlThrottle = new HostThrottle(DEFAULT_REQUEST_INTERVAL_MS)

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
        logger.warn("Ingest.recordSyncRun", "Could not record the sync run", err)
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
    const refreshHours = sourceRefreshHours(source, project ?? {refreshIntervalHours: DEFAULT_REFRESH_HOURS})
    const label = `"${source.title}" (${source.type})`

    try {
        if (!project) throw new Error("Project not found")
        const settings = await getAppSettings({fresh: true})
        const detail = projectIngestDetail(project)
        const stopFetch = new AbortController()
        const signal = AbortSignal.any([AbortSignal.timeout(SYNC_TIMEOUT_MS), stopFetch.signal])
        const log = (msg: string) => logger.info("Ingest.sync", label, msg)
        const existing = (await documents.find({sourceId}, {projection: {_id: 1, ref: 1, hash: 1, title: 1, url: 1, version: 1, updatedAt: 1}}).toArray()) as Array<
            Pick<DocumentRecord, "_id" | "ref" | "hash" | "title" | "url" | "version" | "updatedAt">
        >
        const byRef = new Map(existing.map((d) => [d.ref, d]))
        const chunkOptions = CHUNK_PRESETS[detail]
        const embeddingModel = embeddingKey(settings)
        const embeddingDimensions = settings.embeddingDimensionsParam ? settings.embeddingDimensions : undefined
        const streamingDeduper = detail === "detailed" ? null : createStreamingDeduper(detail === "compact" ? "similar" : "exact")

        let pending: PendingDoc[] = []
        let pendingChunks = 0
        const processedRefs = new Set<string>()
        const persistFailedRefs: string[] = []
        let persistError: string | undefined

        const flush = async () => {
            if (!pending.length) return
            const batch = pending
            pending = []
            pendingChunks = 0

            if (persistError) {
                for (const p of batch) persistFailedRefs.push(p.doc.ref)
                return
            }

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
                try {
                    const {embeddings} = await createEmbeddings(
                        missing.map((m) => m.content),
                        {model: settings.embeddingModel, dimensions: embeddingDimensions}
                    )
                    missing.forEach((m, i) => {
                        if (embeddings[i]) vectors.set(m.hash, embeddings[i]!)
                    })
                    result.embedded += missing.length
                } catch (err: any) {
                    // Keep documents already saved in earlier batches and stop fetching more pages until the next sync
                    persistError = errorText(err, source)
                    for (const p of batch) persistFailedRefs.push(p.doc.ref)
                    stopFetch.abort()
                    logger.warn("Ingest.sync", label, `Embeddings paused sync after ${result.changed} saved doc(s): ${persistError}`)
                    return
                }
            }

            const now = new Date()
            let written = 0
            try {
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
                    processedRefs.add(p.doc.ref)
                    result.changed++
                    written++
                }
            } catch (err: any) {
                persistError = errorText(err, source)
                for (const p of batch.slice(written)) persistFailedRefs.push(p.doc.ref)
                stopFetch.abort()
                logger.warn("Ingest.sync", label, `Persistence paused sync after ${result.changed} saved doc(s): ${persistError}`)
            }
        }

        const ingestDocument = async (doc: FetchedDocument, streamRefine: boolean) => {
            if (persistError) {
                persistFailedRefs.push(doc.ref)
                return
            }
            const markdown = streamRefine ? (streamingDeduper ? streamingDeduper(refineMarkdown(doc.markdown, detail)) : refineMarkdown(doc.markdown, detail)) : doc.markdown
            const prepared = markdown === doc.markdown ? doc : {...doc, markdown}
            const hash = documentHash(prepared.markdown, detail)
            const prev = byRef.get(prepared.ref)
            if (prev && prev.hash === hash) {
                if (prev.title !== prepared.title || (prev.url || "") !== (prepared.url || "")) {
                    const update = prepared.url ? {$set: {title: prepared.title, url: prepared.url}} : {$set: {title: prepared.title}, $unset: {url: "" as const}}
                    await documents.updateOne({_id: prev._id}, update)
                    await chunks.updateMany({documentId: prev._id}, update)
                }
                if ((prev.version || "") !== (prepared.version || "")) {
                    await documents.updateOne({_id: prev._id}, prepared.version ? {$set: {version: prepared.version}} : {$unset: {version: "" as const}})
                }
                processedRefs.add(prepared.ref)
                return
            }
            const docChunks = chunkMarkdown(prepared.markdown, {...chunkOptions, title: prepared.title})
            pending.push({doc: prepared, hash, prevId: prev?._id, chunks: docChunks})
            pendingChunks += docChunks.length
            if (pendingChunks >= EMBED_BATCH) await flush()
        }

        // URL sources stream each fetched page straight into persistence so large crawls stay light on RAM
        let ingestChain = Promise.resolve()
        const onDocument =
            source.type === "url"
                ? (doc: FetchedDocument) => {
                      const next = ingestChain.then(() => ingestDocument(doc, true))
                      ingestChain = next.catch(() => {})
                      return next
                  }
                : undefined

        const outcome = await fetchSource(source, {
            userAgent: settings.userAgent || defaultUserAgent(),
            detail,
            requestIntervalMs: settings.requestIntervalMs,
            throttle: sharedUrlThrottle,
            signal,
            log,
            extractBinary: createBinaryExtractor(detail),
            summarizeCode: createCodeSummarizer(settings.codeSummaryModel, {detail, maxPerSync: Number(useRuntimeConfig().codeSummaryMaxPerSync) || 0, signal, log}),
            knownVersions: new Map(existing.flatMap((d) => (d.version ? [[d.ref, d.version] as const] : []))),
            knownUpdatedAt: new Map(existing.map((d) => [d.ref, new Date(d.updatedAt).getTime()])),
            onDocument,
            knownRevision: existing.length ? source.syncedRevision : undefined,
            revisionSalt: revisionSalt(source, detail, settings.codeSummaryModel)
        })
        await ingestChain
        // Unchanged since the last complete sync: every stored document is kept as is
        if (outcome.upToDate) outcome.unchanged = existing.map((d) => d.ref)

        if (!outcome.documents.length && !outcome.streamedRefs?.length && !outcome.unchanged?.length) {
            const reason = outcome.errors[0] || outcome.skipped[0]?.reason
            throw new Error(
                source.type === "git"
                    ? `No indexable files found${reason ? ` (${reason})` : " — check the include patterns and branch"}`
                    : source.type === "drive"
                      ? `No indexable files found${reason ? ` (${reason})` : ""}`
                      : `No indexable content${reason ? ` (${reason})` : ""}`
            )
        }

        if (outcome.documents.length) {
            const refined = outcome.documents.map((doc) => ({...doc, markdown: refineMarkdown(doc.markdown, detail)}))
            const fetched = detail === "detailed" ? refined : dedupeAcrossDocuments(refined, detail === "compact" ? "similar" : "exact")
            for (const doc of fetched) await ingestDocument(doc, false)
        }
        await flush()

        // If embeddings or persistence failed before a single document existed or was saved, fail the sync with that error
        if (persistError && !processedRefs.size && !existing.length && !outcome.unchanged?.length) {
            throw new Error(persistError)
        }

        const incomplete = persistError || outcome.incomplete

        // Documents that disappeared from the source (transient failures and incomplete fetches keep their previous version)
        const keep = new Set([...processedRefs, ...(outcome.streamedRefs ?? []), ...outcome.failedRefs, ...persistFailedRefs, ...(outcome.unchanged ?? [])])
        const gone = incomplete ? [] : existing.filter((d) => !keep.has(d.ref)).map((d) => d._id)
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
                .aggregate<{count: number; bytes: number}>([{$match: {sourceId}}, {$group: {_id: null, count: {$sum: 1}, bytes: {$sum: {$strLenBytes: {$ifNull: ["$markdown", ""]}}}}}])
                .toArray()
                .then((rows) => rows[0] ?? {count: 0, bytes: 0}),
            chunks.countDocuments({sourceId, sourceType: source.type})
        ])
        const documentCount = totals.count
        const warnings = [incomplete, outcome.failedRefs.length ? `${outcome.failedRefs.length} item(s) could not be fetched and kept their previous version: ${outcome.errors[0] ?? ""}`.trim() : ""].filter(Boolean)
        const partial = warnings.length ? warnings.join(" · ").slice(0, 500) : undefined
        const message = partial ? scrubGitSecrets(partial, [source.options?.accessToken]) : undefined
        const nextHours = incomplete ? Math.min(INCOMPLETE_RETRY_HOURS, refreshHours) : refreshHours
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
        if (outcome.upToDate) logger.info("Ingest.sync", label, `Unchanged since the last sync, ${documentCount} docs kept`)
        else logger.info("Ingest.sync", label, `Synced in ${(durationMs / 1000).toFixed(1)}s: ${documentCount} docs (${result.changed} changed, ${result.removed} removed), ${chunkCount} chunks, ${result.embedded} embedded`)
        return result
    } catch (err: any) {
        const message = errorText(err, source)
        result.error = message
        logger.warn("Ingest.sync", label, `Failed: ${message}`)
        // Manual only sources are not retried automatically
        const retryHours = Math.min(1, refreshHours)
        // Recount stored docs/chunks when earlier streaming batches already wrote data before failing
        let counts: {documents: number; bytes: number; chunks: number} | undefined
        if (result.changed > 0) {
            try {
                const [totals, chunkCount] = await Promise.all([
                    documents
                        .aggregate<{count: number; bytes: number}>([{$match: {sourceId}}, {$group: {_id: null, count: {$sum: 1}, bytes: {$sum: {$strLenBytes: {$ifNull: ["$markdown", ""]}}}}}])
                        .toArray()
                        .then((rows) => rows[0] ?? {count: 0, bytes: 0}),
                    chunks.countDocuments({sourceId, sourceType: source.type})
                ])
                counts = {documents: totals.count, bytes: totals.bytes, chunks: chunkCount}
                result.documents = totals.count
                result.chunks = chunkCount
            } catch {}
        }
        await sources
            .updateOne(
                {_id: sourceId},
                {
                    $set: {
                        status: "error",
                        lastError: message,
                        lastDurationMs: Date.now() - startedAt,
                        ...(counts ? {documentCount: counts.documents, chunkCount: counts.chunks} : {}),
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
            ...(counts ? {documents: counts.documents, bytes: counts.bytes, chunks: counts.chunks} : {}),
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
