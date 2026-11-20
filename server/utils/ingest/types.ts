import type {IngestDetail} from "#shared/types"
import type {BinaryMime} from "./binary"
import type {HostThrottle} from "./throttle"

export interface FetchedDocument {
    /** Stable identifier inside the source: normalized URL (web), file path (git) or Drive file id */
    ref: string
    url?: string
    title: string
    markdown: string
    /** Source-specific revision (e.g. Drive file version): the file is not re-downloaded while it matches `knownVersions` */
    version?: string
}

export interface FetchOutcome {
    documents: FetchedDocument[]
    /** Refs already streamed to persistence via `FetchContext.onDocument` (markdown is not retained in RAM) */
    streamedRefs?: string[]
    /** Refs whose stored version is still current: not re-fetched, their documents are kept as-is */
    unchanged?: string[]
    /** Items intentionally not indexed (unsupported files, tiny images, empty pages…) */
    skipped: Array<{ref: string; reason: string}>
    /** Items that failed transiently: their previous documents are kept */
    failedRefs: string[]
    /** First few error messages, for diagnostics */
    errors: string[]
    /**
     * Set when the fetch stopped early or deferred work (rate limited crawl, code summary budget): documents that are
     * missing from this outcome keep their previous version, and the source is synced again soon.
     */
    incomplete?: string
    /** Revision of the fetched content (git: commit + settings fingerprint), stored after a complete sync */
    revision?: string
    /** The content is still at `FetchContext.knownRevision`: nothing was fetched and every stored document is kept */
    upToDate?: boolean
}

export interface BinaryFile {
    name: string
    mime: BinaryMime
    bytes: Uint8Array
}

/** Markdown of a PDF/image, or why it isn't indexed. Throwing means a transient failure. */
export type ExtractResult = {title?: string; markdown: string} | {skipped: string}

/** A source code file of a git repository, for summarization */
export interface CodeFile {
    path: string
    lang: string
    content: string
}

export interface RepoContext {
    name: string
    url: string
    /** README of the repository root (may be empty) */
    readme: string
    /** All indexed file paths */
    tree: string[]
}

export interface CodeSummaries {
    /** Markdown summary per file path (files without a summary are indexed as plain code) */
    files: Map<string, string>
    /** Files the model found without meaningful content (re-exports, generated code, trivial config) */
    trivial?: Set<string>
    /** Overview of how the application works, built from all file summaries */
    overview?: string
    /** Why the overview wasn't (re)generated this time: the previous one is kept */
    overviewError?: string
    /** Summaries deferred to the next sync (budget reached, errors) */
    incomplete?: string
}

export interface FetchContext {
    userAgent: string
    /** Ingestion preset of the project (default balanced): how much of each page/file is converted */
    detail?: IngestDetail
    /** URL sources: minimum delay between requests to the same host */
    requestIntervalMs?: number
    /** URL sources: shared per-host throttle (remembers backoff across retries and concurrent syncs) */
    throttle?: HostThrottle
    signal?: AbortSignal
    log?: (msg: string) => void
    /** Converts PDFs, images and Office files to markdown. Without it these files are not indexed. */
    extractBinary?: (file: BinaryFile) => Promise<ExtractResult>
    /** Revision of the last complete sync; sources may skip fetching entirely while it is current (git) */
    knownRevision?: string
    /** Fingerprint of the sync settings (preset, options, models), combined into `FetchOutcome.revision` */
    revisionSalt?: string
    /** ref → version of the currently stored document; sources may skip re-downloading unchanged items (Drive, URL) */
    knownVersions?: Map<string, string>
    /** ref → updatedAt (ms) of currently stored documents; crawlers use this to fetch unindexed and oldest pages first */
    knownUpdatedAt?: Map<string, number>
    /** Streaming sink: when set, fetched documents are persisted as they arrive instead of buffered in `outcome.documents` */
    onDocument?: (doc: FetchedDocument) => Promise<void>
    /** Summarizes source code files of a git repository. Without it code is indexed as is. */
    summarizeCode?: (repo: RepoContext, files: CodeFile[]) => Promise<CodeSummaries>
}

export function emptyFetchOutcome(): FetchOutcome {
    return {documents: [], skipped: [], failedRefs: [], errors: []}
}
