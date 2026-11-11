// Source code → summaries: every code file is summarized with the repository as context (README, file tree), then
// an overview of how the whole application works is written from all file summaries. Results are cached, so
// unchanged files are never sent twice.
import {createHash} from "node:crypto"
import type {CodeFile, CodeSummaries, RepoContext} from "./types"

const CONCURRENCY = 4
const MAX_TREE_LINES = 600
const MAX_TREE_CHARS = 24_000
const MAX_OVERVIEW_INPUT_CHARS = 240_000

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

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

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
export function createCodeSummarizer(model: string, opts: {maxPerSync?: number; signal?: AbortSignal; log?: (msg: string) => void} = {}) {
    const summaryModel = model.trim()
    if (!summaryModel) return undefined
    const maxPerSync = Math.max(0, opts.maxPerSync ?? 500)

    return async (repo: RepoContext, files: CodeFile[]): Promise<CodeSummaries> => {
        const {extractions} = await useCollections()
        const context = repoContext(repo)
        const result: CodeSummaries = {files: new Map()}
        const keyOf = (f: CodeFile) => `code:${summaryModel}:${sha256(`${f.path}\0${f.content}`)}`

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
                        maxTokens: 1200,
                        signal: opts.signal,
                        messages: [
                            {role: "system", content: FILE_PROMPT},
                            {role: "user", content: `${context}\n\n# File: ${file.path}\n\`\`\`\`${file.lang}\n${file.content}\n\`\`\`\``}
                        ]
                    })
                    const text = unfence(content.trim())
                    const summary = text === "NONE" ? "" : text
                    const now = new Date()
                    await extractions.updateOne({_id: key}, {$set: {markdown: summary, usedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
                    if (summary) result.files.set(file.path, summary)
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
        const key = `overview:${summaryModel}:${sha256(input)}`
        const hit = await extractions.findOneAndUpdate({_id: key}, {$set: {usedAt: new Date()}}, {projection: {markdown: 1}})
        if (hit) {
            result.overview = hit.markdown
            return result
        }
        try {
            const {content} = await chatCompletion({
                model: summaryModel,
                temperature: 0.1,
                maxTokens: 8000,
                signal: opts.signal,
                messages: [
                    {role: "system", content: OVERVIEW_PROMPT},
                    {role: "user", content: input}
                ]
            })
            const body = unfence(content.trim())
            const overview = body ? `# ${repo.name}: how the application works\n\n${body.replace(/^#\s+.+\n+/, "")}` : ""
            const now = new Date()
            if (overview) await extractions.updateOne({_id: key}, {$set: {markdown: overview, usedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
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
