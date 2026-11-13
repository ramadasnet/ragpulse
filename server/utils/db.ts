import {MongoClient, type Db, type Collection} from "mongodb"
import {randomBytes} from "node:crypto"
import type {ApiToken, ChatMessage, ChatSession, Chunk, DocumentRecord, Faq, Project, Question, Source, SyncRun, User} from "#shared/types"
import type {SettingsDoc} from "./settings"
import logger from "./logger"

export interface LockDoc {
    _id: string
    owner: string
    expiresAt: Date
}

/** Cached LLM output: vision transcriptions (`model:sha256(bytes)`) and code summaries (`code:…`, `overview:…`, `overview-latest:…`) */
export interface ExtractionDoc {
    _id: string
    markdown: string
    /** Latest overview of a repository: `path\0sha256(summary)` of every input it was written from */
    basis?: string[]
    createdAt: Date
    usedAt: Date
}

export interface Collections {
    users: Collection<User>
    projects: Collection<Project>
    sources: Collection<Source>
    faqs: Collection<Faq>
    documents: Collection<DocumentRecord>
    chunks: Collection<Chunk>
    sessions: Collection<ChatSession>
    messages: Collection<ChatMessage>
    questions: Collection<Question>
    apiTokens: Collection<ApiToken>
    syncRuns: Collection<SyncRun>
    locks: Collection<LockDoc>
    extractions: Collection<ExtractionDoc>
    settings: Collection<SettingsDoc>
}

export const VECTOR_INDEX_NAME = "chunk_embeddings"

/** `atlas` when `$vectorSearch` is available, `fallback` for in-app cosine similarity. */
export type VectorMode = "atlas" | "fallback" | "unknown"

interface DbState {
    client: MongoClient
    db: Db
    collections: Collections
    vectorMode: VectorMode
}

let statePromise: Promise<DbState> | null = null
let vectorMode: VectorMode = "unknown"

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** Short, URL-safe random id (base62). */
export function newId(length = 16): string {
    const bytes = randomBytes(length)
    let id = ""
    for (let i = 0; i < length; i++) id += ALPHABET[bytes[i]! % ALPHABET.length]
    return id
}

async function connect(): Promise<DbState> {
    const config = useRuntimeConfig()
    const client = new MongoClient(config.mongodbUri, {maxPoolSize: 20, appName: "ragpulse"})
    await client.connect()
    const db = client.db()
    const collections: Collections = {
        users: db.collection<User>("users"),
        projects: db.collection<Project>("projects"),
        sources: db.collection<Source>("sources"),
        faqs: db.collection<Faq>("faqs"),
        documents: db.collection<DocumentRecord>("documents"),
        chunks: db.collection<Chunk>("chunks"),
        sessions: db.collection<ChatSession>("sessions"),
        messages: db.collection<ChatMessage>("messages"),
        questions: db.collection<Question>("questions"),
        apiTokens: db.collection<ApiToken>("apiTokens"),
        syncRuns: db.collection<SyncRun>("syncRuns"),
        locks: db.collection<LockDoc>("locks"),
        extractions: db.collection<ExtractionDoc>("extractions"),
        settings: db.collection<SettingsDoc>("settings")
    }
    await ensureIndexes(collections)
    await migrateEmbeddingKeys(collections)
    const state: DbState = {client, db, collections, vectorMode: "unknown"}
    // Settings are read directly: getAppSettings() needs the connection that is being set up here
    const stored = await collections.settings.findOne({_id: "app"}, {projection: {embeddingDimensions: 1}})
    vectorMode = await ensureVectorIndex(db, collections, Number(stored?.embeddingDimensions || config.embeddingDimensions))
    state.vectorMode = vectorMode
    logger.info("Database.connect", `Connected to ${db.databaseName}, vector search: ${vectorMode}`)
    return state
}

async function ensureIndexes(c: Collections) {
    await Promise.all([
        c.users.createIndex({email: 1}, {unique: true}),
        c.sources.createIndex({projectId: 1}),
        c.sources.createIndex({status: 1, nextSyncAt: 1}),
        c.faqs.createIndex({projectId: 1, updatedAt: -1}),
        c.documents.createIndex({sourceId: 1, ref: 1}, {unique: true}),
        c.documents.createIndex({projectId: 1}),
        c.chunks.createIndex({projectId: 1}),
        c.chunks.createIndex({documentId: 1}),
        c.chunks.createIndex({sourceId: 1}),
        c.chunks.createIndex({projectId: 1, hash: 1}),
        // Finds chunks that need re-embedding after an embedding model change
        c.chunks.createIndex({embeddingModel: 1}),
        c.sessions.createIndex({projectId: 1, lastMessageAt: -1}),
        c.sessions.createIndex({projectId: 1, createdAt: -1}),
        // Chat session retention cleanup
        c.sessions.createIndex({lastMessageAt: 1}),
        c.messages.createIndex({sessionId: 1, createdAt: 1}),
        c.messages.createIndex({projectId: 1, createdAt: -1}),
        c.questions.createIndex({projectId: 1, status: 1, createdAt: -1}),
        c.questions.createIndex({sessionId: 1}),
        c.apiTokens.createIndex({tokenHash: 1}, {unique: true}),
        c.apiTokens.createIndex({userId: 1}),
        c.syncRuns.createIndex({sourceId: 1, startedAt: -1}),
        c.syncRuns.createIndex({projectId: 1}),
        // Sync history retention cleanup
        c.syncRuns.createIndex({startedAt: 1}),
        c.locks.createIndex({expiresAt: 1}, {expireAfterSeconds: 0}),
        // Refreshed on every sync that still uses the entry
        c.extractions.createIndex({usedAt: 1}, {expireAfterSeconds: 90 * 24 * 3600})
    ])
}

/** Chunks from before embedding keys stored the bare model name: append the actual vector size (`model#dimensions`). */
async function migrateEmbeddingKeys(c: Collections) {
    try {
        const res = await c.chunks.updateMany({embeddingModel: {$type: "string", $not: /#\d+$/}, embedding: {$type: "array"}}, [{$set: {embeddingModel: {$concat: ["$embeddingModel", "#", {$toString: {$size: "$embedding"}}]}}}])
        if (res.modifiedCount) logger.info("Database.migration", `Tagged ${res.modifiedCount} chunk(s) with their embedding dimensions`)
    } catch (err: any) {
        logger.warn("Database.migration", "Embedding key migration failed", err)
    }
}

function vectorIndexDefinition(dimensions: number) {
    return {
        fields: [
            {type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine"},
            {type: "filter", path: "projectId"},
            {type: "filter", path: "sourceType"},
            {type: "filter", path: "embeddingModel"}
        ]
    }
}

/** True when an existing index definition differs from the wanted one (dimensions or filter fields). */
export function vectorIndexOutdated(existing: any, dimensions: number): boolean {
    const fields: any[] = existing?.latestDefinition?.fields ?? existing?.definition?.fields ?? []
    const vector = fields.find((f) => f?.type === "vector" && f?.path === "embedding")
    if (!vector || Number(vector.numDimensions) !== dimensions) return true
    const filters = new Set(fields.filter((f) => f?.type === "filter").map((f) => f.path))
    return vectorIndexDefinition(dimensions).fields.some((f) => f.type === "filter" && !filters.has(f.path))
}

/**
 * Makes sure an up to date Atlas Vector Search index exists on `chunks.embedding`.
 * Works on MongoDB Atlas, the `mongodb/mongodb-atlas-local` image and Community 8.2+ with mongot.
 * On a plain `mongod` this fails and we fall back to in-app cosine similarity.
 */
async function ensureVectorIndex(db: Db, c: Collections, dimensions: number): Promise<VectorMode> {
    try {
        // The collection must exist before creating a search index
        const existing = await db.listCollections({name: "chunks"}).toArray()
        if (!existing.length) await db.createCollection("chunks")

        const indexes = await c.chunks.listSearchIndexes(VECTOR_INDEX_NAME).toArray()
        if (!indexes.length) {
            await c.chunks.createSearchIndex({name: VECTOR_INDEX_NAME, type: "vectorSearch", definition: vectorIndexDefinition(dimensions)})
            logger.info("Database.vectorIndex", `Created vector search index "${VECTOR_INDEX_NAME}" (${dimensions} dims)`)
        } else if (vectorIndexOutdated(indexes[0], dimensions)) {
            // The previous index keeps serving queries while the new definition builds
            await c.chunks.updateSearchIndex(VECTOR_INDEX_NAME, vectorIndexDefinition(dimensions))
            logger.info("Database.vectorIndex", `Updated vector search index "${VECTOR_INDEX_NAME}" (${dimensions} dims)`)
        }
        return "atlas"
    } catch (err: any) {
        logger.warn("Database.vectorIndex", "Vector search unavailable, using in-app similarity fallback", err?.codeName || err)
        return "fallback"
    }
}

/** Re-creates/updates the vector index for new embedding dimensions (after an embedding model change). */
export async function refreshVectorIndex(dimensions: number): Promise<VectorMode> {
    const state = await getState()
    vectorMode = await ensureVectorIndex(state.db, state.collections, dimensions)
    state.vectorMode = vectorMode
    return vectorMode
}

async function getState(): Promise<DbState> {
    if (!statePromise) {
        statePromise = connect().catch((err) => {
            statePromise = null
            throw err
        })
    }
    return statePromise
}

/** Typed collections. Usage: `const { projects } = await useCollections()` */
export async function useCollections(): Promise<Collections> {
    return (await getState()).collections
}

export async function useDb(): Promise<Db> {
    return (await getState()).db
}

export function getVectorMode(): VectorMode {
    return vectorMode
}

/** Called when `$vectorSearch` fails at query time, so we stop trying it. */
export function setVectorMode(mode: VectorMode) {
    vectorMode = mode
}

/**
 * Simple distributed lock backed by a TTL collection.
 * Returns true if acquired. Release with `releaseLock`.
 */
export async function acquireLock(name: string, owner: string, ttlSeconds: number): Promise<boolean> {
    const {locks} = await useCollections()
    const now = new Date()
    try {
        await locks.updateOne({_id: name, $or: [{expiresAt: {$lt: now}}, {owner}]}, {$set: {owner, expiresAt: new Date(now.getTime() + ttlSeconds * 1000)}}, {upsert: true})
        return true
    } catch (err: any) {
        if (err?.code === 11000) return false
        throw err
    }
}

export async function releaseLock(name: string, owner: string) {
    const {locks} = await useCollections()
    await locks.deleteOne({_id: name, owner})
}

export async function closeDb() {
    if (!statePromise) return
    const state = await statePromise.catch(() => null)
    statePromise = null
    await state?.client.close()
}
