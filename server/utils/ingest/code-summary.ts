// Source code → summaries: every code file is summarized with the repository as context (README, file tree), then
// an overview of how the whole application works is written from all file summaries. Results are cached, so
// unchanged files are never sent twice.
import {createHash} from "node:crypto"
import type {IngestDetail} from "#shared/types"
import type {CodeFile, CodeSummaries, RepoContext} from "./types"

const CONCURRENCY = 4
const MAX_TREE_LINES = 600
const MAX_TREE_CHARS = 24_000
const MAX_OVERVIEW_INPUT_CHARS = 240_000
/** The overview is written again only when at least this share of its inputs (file summaries, README) changed */
export const OVERVIEW_REFRESH_SHARE = 0.1

const FILE_PROMPT = `You document the source code of an application for a support knowledge base. A support assistant uses your notes to answer technical questions from users and developers about how the application works.
You receive context about the repository (README, file tree) and one file. Write a concise Markdown summary of that file (at most ~250 words):
- Its responsibility and where it fits in the application (which part calls it, what it calls), based on the file tree and the code.
- The main functions, classes, components, routes, endpoints, commands or jobs it defines, and what each does.
- Behaviour that matters to users: inputs and outputs, configuration (environment variables, settings, defaults, limits), validation and error cases, side effects (storage, network, email, queues).
Use the exact names from the code (in backticks). Use short bullet lists. Do not paste code longer than one line. Do not speculate beyond the code and context.
If the file has no meaningful content (only re-exports, generated code, trivial config), reply with exactly: NONE`

const OVERVIEW_PROMPT = `You write the technical overview of an application for a support knowledge base. A support assistant uses it to answer technical questions from users and developers.
You receive the README, the file tree and summaries of the source files. Write a clear Markdown document explaining how the application works, with these sections (skip sections that do not apply):
## Purpose
## Architecture and tech stack
## Main components (directories and key files, and what they are responsible for)
## How it works (the main flows step by step: requests, user actions, background jobs, data flow)
## Data and storage
## Configuration (environment variables, settings and their defaults)
## APIs and integrations
## Build, run and deployment
Use the exact names of files, functions, endpoints and variables (in backticks). Be specific and factual, use only the information provided, and do not invent features.`

const FILE_PROMPT_COMPACT = `You document the source code of an application for a compact support knowledge base. A support assistant uses your notes to answer questions about how the application works.
You receive context about the repository (README, file tree) and one file. Write a very short Markdown summary of that file (at most ~100 words):
- One sentence on its responsibility and where it fits in the application.
- A short list of only the most important functions, classes, components, routes, endpoints or settings, with a few words each. Skip helpers and internal details.
- Only the behaviour that matters most to users: key configuration, limits and error cases.
Use the exact names from the code (in backticks). Do not paste code. Do not speculate beyond the code and context.
If the file has no meaningful content (only re-exports, generated code, trivial config, tiny helpers), reply with exactly: NONE`

const FILE_PROMPT_DETAILED = `You document the source code of an application for a support knowledge base. A support assistant uses your notes to answer in-depth technical questions from users and developers about how the application works.
You receive context about the repository (README, file tree) and one file. Write a thorough Markdown summary of that file (at most ~500 words):
- Its responsibility and where it fits in the application.
- References: what it imports and depends on (internal modules, libraries, external services and APIs), and which parts of the application use it, based on the file tree and the code.
- The functions, classes, components, routes, endpoints, commands or jobs it defines, with their parameters, return values and what each does.
- Behaviour that matters to users: inputs and outputs, configuration (environment variables, settings, defaults, limits), validation and error cases, side effects (storage, network, email, queues).
- Intricacies: edge cases, ordering and concurrency, caching, retries, performance and security considerations, non-obvious logic.
- Source comments: the essence of meaningful code and doc comments (explanations, warnings, TODO/FIXME notes), attributed to the code they describe.
Use the exact names from the code (in backticks). Use headings and bullet lists. Snippets of at most a few lines are allowed when they clarify behaviour. Do not speculate beyond the code and context.
If the file has no meaningful content (only re-exports, generated code, trivial config), reply with exactly: NONE`

const OVERVIEW_PROMPT_COMPACT = `You write a short technical overview of an application for a compact support knowledge base. A support assistant uses it to answer questions from users and developers.
You receive the README, the file tree and summaries of the source files. Write a concise Markdown document (at most ~600 words) with these sections (skip sections that do not apply):
## Purpose
## Main components
## How it works
## Configuration
Use the exact names of files, functions, endpoints and variables (in backticks). Be factual, use only the information provided, and do not invent features.`

const OVERVIEW_PROMPT_DETAILED = `${OVERVIEW_PROMPT}
Then add these sections when the information is available:
## Security and permissions
## Error handling and edge cases
## Notable implementation details (caching, concurrency, retries, limits, performance)
Be thorough: describe every main flow and component, and reference the files that implement them.`

interface SummaryPreset {
    filePrompt: string
    fileTokens: number
    overviewPrompt: string
    overviewTokens: number
}

const SUMMARY_PRESETS: Record<IngestDetail, SummaryPreset> = {
    compact: {filePrompt: FILE_PROMPT_COMPACT, fileTokens: 500, overviewPrompt: OVERVIEW_PROMPT_COMPACT, overviewTokens: 2000},
    balanced: {filePrompt: FILE_PROMPT, fileTokens: 1200, overviewPrompt: OVERVIEW_PROMPT, overviewTokens: 8000},
    detailed: {filePrompt: FILE_PROMPT_DETAILED, fileTokens: 2500, overviewPrompt: OVERVIEW_PROMPT_DETAILED, overviewTokens: 12_000}
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/**
 * Share of inputs that changed between two overview bases (`path\0hash` entries): added, removed and modified paths
 * over all paths of both.
 */
export function changedShare(previous: string[], current: string[]): number {
    const toMap = (basis: string[]) => new Map(basis.map((entry) => [entry.slice(0, entry.lastIndexOf("\0")), entry]))
    const before = toMap(previous)
    const after = toMap(current)
    const paths = new Set([...before.keys(), ...after.keys()])
    if (!paths.size) return 0
    let changed = 0
    for (const path of paths) if (before.get(path) !== after.get(path)) changed++
    return changed / paths.size
}

function unfence(text: string): string {
    return /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text)?.[1]?.trim() ?? text
}

function treeText(tree: string[]): string {
    const lines: string[] = []
    let size = 0
    for (const path of tree) {
        if (lines.length >= MAX_TREE_LINES || size + path.length > MAX_TREE_CHARS) {
            lines.push(`… and ${tree.length - lines.length} more files`)
            break
        }
        lines.push(path)
        size += path.length + 1
    }
    return lines.join("\n")
}

function repoContext(repo: RepoContext): string {
    return `Repository: ${repo.name} (${repo.url})\n\n## README\n${repo.readme.trim() || "(none)"}\n\n## Files\n${treeText(repo.tree)}`
}

/** Creates the code summarizer for one source sync (the summary budget is per sync). Returns undefined when disabled. */
export function createCodeSummarizer(model: string, opts: {detail?: IngestDetail; maxPerSync?: number; signal?: AbortSignal; log?: (msg: string) => void} = {}) {
    const summaryModel = model.trim()
    if (!summaryModel) return undefined
    const maxPerSync = Math.max(0, opts.maxPerSync ?? 500)
    const detail = opts.detail ?? "balanced"
    const preset = SUMMARY_PRESETS[detail]
    // Each preset has its own cache (balanced keeps the original keys)
    const keyPrefix = detail === "balanced" ? "" : `-${detail}`

    return async (repo: RepoContext, files: CodeFile[]): Promise<CodeSummaries> => {
        const {extractions} = await useCollections()
        const context = repoContext(repo)
        const result: CodeSummaries = {files: new Map(), trivial: new Set()}
        const keyOf = (f: CodeFile) => `code${keyPrefix}:${summaryModel}:${sha256(`${f.path}\0${f.content}`)}`

        // Cached summaries first (refreshing `usedAt` so they don't expire while in use)
        const keys = files.map(keyOf)
        const cached = new Map<string, string>()
        for (let i = 0; i < keys.length; i += 500) {
            const batch = keys.slice(i, i + 500)
            const docs = await extractions.find({_id: {$in: batch}}, {projection: {markdown: 1}}).toArray()
            for (const d of docs) cached.set(d._id, d.markdown)
            if (docs.length) await extractions.updateMany({_id: {$in: docs.map((d) => d._id)}}, {$set: {usedAt: new Date()}})
        }

        const todo: Array<{file: CodeFile; key: string}> = []
        files.forEach((file, i) => {
            const hit = cached.get(keys[i]!)
            if (hit === undefined) todo.push({file, key: keys[i]!})
            else if (hit) result.files.set(file.path, hit)
            else result.trivial!.add(file.path)
        })

        const deferred = Math.max(0, todo.length - maxPerSync)
        const queue = todo.slice(0, maxPerSync)
        let failed = 0
        let firstError = ""
        const worker = async () => {
            while (queue.length) {
                if (opts.signal?.aborted) throw new Error("Sync aborted")
                const {file, key} = queue.shift()!
                try {
                    const {content} = await chatCompletion({
                        model: summaryModel,
                        temperature: 0,
                        maxTokens: preset.fileTokens,
                        signal: opts.signal,
                        messages: [
                            {role: "system", content: preset.filePrompt},
                            {role: "user", content: `${context}\n\n# File: ${file.path}\n\`\`\`\`${file.lang}\n${file.content}\n\`\`\`\``}
                        ]
                    })
                    const text = unfence(content.trim())
                    const summary = text === "NONE" ? "" : text
                    const now = new Date()
                    await extractions.updateOne({_id: key}, {$set: {markdown: summary, usedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
                    if (summary) result.files.set(file.path, summary)
                    else result.trivial!.add(file.path)
                } catch (err: any) {
                    if (opts.signal?.aborted) throw err
                    failed++
                    firstError ||= `${file.path}: ${String(err?.statusMessage || err?.message || err).slice(0, 200)}`
                }
            }
        }
        await Promise.all(Array.from({length: CONCURRENCY}, worker))
        opts.log?.(`code summaries: ${files.length - todo.length} cached, ${todo.length - deferred - failed} new, ${failed} failed, ${deferred} deferred`)

        if (deferred || failed) {
            const parts = [deferred ? `${deferred} file(s) deferred (limit of ${maxPerSync} summaries per sync)` : "", failed ? `${failed} failed (${firstError})` : ""].filter(Boolean)
            result.incomplete = `Code summaries incomplete: ${parts.join(", ")}. They continue on the next sync.`
            // Regenerate the overview only from a complete set of summaries
            result.overviewError = result.incomplete
            return result
        }

        // Overview from all summaries (shallow paths first, so the big picture survives the input cap)
        const ordered = [...result.files.entries()].sort(([a], [b]) => a.split("/").length - b.split("/").length || a.localeCompare(b))
        let summariesText = ""
        let included = 0
        for (const [path, summary] of ordered) {
            const block = `### ${path}\n${summary.trim()}\n\n`
            if (summariesText.length + block.length > MAX_OVERVIEW_INPUT_CHARS) break
            summariesText += block
            included++
        }
        if (!included) return result
        const input = `${context}\n\n## File summaries${included < ordered.length ? ` (${included} of ${ordered.length} files)` : ""}\n\n${summariesText.trim()}`
        const key = `overview${keyPrefix}:${summaryModel}:${sha256(input)}`
        // The latest overview of this repository and the inputs it was written from
        const latestKey = `overview-latest${keyPrefix}:${summaryModel}:${sha256(repo.url)}`
        const basis = [`\0README\0${sha256(repo.readme)}`, ...ordered.map(([path, summary]) => `${path}\0${sha256(summary)}`)]
        const remember = async (markdown: string) => {
            const now = new Date()
            await extractions.updateOne({_id: latestKey}, {$set: {markdown, basis, usedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
        }
        const hit = await extractions.findOneAndUpdate({_id: key}, {$set: {usedAt: new Date()}}, {projection: {markdown: 1}})
        if (hit) {
            result.overview = hit.markdown
            await remember(hit.markdown)
            return result
        }
        const latest = await extractions.findOne({_id: latestKey}, {projection: {markdown: 1, basis: 1}})
        if (latest?.markdown && latest.basis) {
            const share = changedShare(latest.basis, basis)
            if (share < OVERVIEW_REFRESH_SHARE) {
                await extractions.updateOne({_id: latestKey}, {$set: {usedAt: new Date()}})
                opts.log?.(`application overview kept (${(share * 100).toFixed(1)}% of its inputs changed, regenerated from ${OVERVIEW_REFRESH_SHARE * 100}%)`)
                result.overview = latest.markdown
                return result
            }
        }
        try {
            const {content} = await chatCompletion({
                model: summaryModel,
                temperature: 0.1,
                maxTokens: preset.overviewTokens,
                signal: opts.signal,
                messages: [
                    {role: "system", content: preset.overviewPrompt},
                    {role: "user", content: input}
                ]
            })
            const body = unfence(content.trim())
            const overview = body ? `# ${repo.name}: how the application works\n\n${body.replace(/^#\s+.+\n+/, "")}` : ""
            const now = new Date()
            if (overview) {
                await extractions.updateOne({_id: key}, {$set: {markdown: overview, usedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
                await remember(overview)
            }
            result.overview = overview || undefined
            if (!overview) result.overviewError = "empty overview"
        } catch (err: any) {
            if (opts.signal?.aborted) throw err
            result.overviewError = String(err?.statusMessage || err?.message || err).slice(0, 200)
            result.incomplete = `Application overview could not be generated: ${result.overviewError}`
        }
        return result
    }
}
