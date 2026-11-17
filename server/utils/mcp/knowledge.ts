import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import type {Faq} from "#shared/types"
import {type McpContext, McpToolError, mcpEscapeRegex, mcpJson, mcpOk, mcpProject, mcpSafely, mcpTruncate} from "./context"
import {mcpProjectIdArg} from "./projects"
import {RAG_MIN_SCORE} from "../rag"
import logger from "../logger"

function sourceView(source: Parameters<typeof serializeSource>[0]) {
    const s = serializeSource(source)
    return {
        id: s._id,
        type: s.type,
        title: s.title,
        url: s.url,
        status: s.status,
        options: s.options,
        refreshIntervalHours: s.refreshIntervalHours,
        lastSyncAt: s.lastSyncAt,
        nextSyncAt: s.nextSyncAt,
        lastError: s.lastError,
        lastDurationMs: s.lastDurationMs,
        documentCount: s.documentCount,
        chunkCount: s.chunkCount
    }
}

function faqView(f: Faq) {
    return {id: f._id, question: f.question, answer: f.answer, updatedAt: f.updatedAt}
}

/** Indexes a FAQ entry and captures any embedding error as a non-fatal warning. */
async function tryIndexFaq(faq: Faq): Promise<{indexed: boolean; warning?: string}> {
    try {
        await indexFaq(faq)
        return {indexed: true}
    } catch (err: any) {
        const warning = `FAQ saved but indexing failed: ${err?.message || err}`
        logger.error("MCP.knowledge", `FAQ indexing failed for ${faq._id}`, err)
        return {indexed: false, warning}
    }
}

/** Serializes in-process operations per FAQ entry so an update can never interleave with a delete or another update (and resurrect a deleted index chunk). */
const faqLocks = new Map<string, Promise<unknown>>()
async function withFaqLock<T>(faqId: string, fn: () => Promise<T>): Promise<T> {
    const previous = faqLocks.get(faqId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(fn)
    const tail = run.catch(() => undefined)
    faqLocks.set(faqId, tail)
    try {
        return await run
    } finally {
        if (faqLocks.get(faqId) === tail) faqLocks.delete(faqId)
    }
}

const DOCUMENT_DEFAULT_CHARS = 20000
const DOCUMENT_MAX_CHARS = 50000

export function registerMcpKnowledgeTools(server: McpServer, ctx: McpContext) {
    server.registerTool(
        "list_sources",
        {
            title: "List knowledge sources",
            description: "Lists the knowledge sources (websites, git repos, Google Drive folders) of a project with sync status. Requires sources:manage.",
            inputSchema: {project_id: mcpProjectIdArg},
            annotations: {readOnlyHint: true}
        },
        ({project_id}) =>
            mcpSafely(ctx, "list_sources", async () => {
                const project = await mcpProject(ctx, project_id, "sources:manage")
                const {sources} = await useCollections()
                const items = (await sources.find({projectId: project._id}).sort({createdAt: 1}).toArray()).map(sourceView)
                const summary = items.length
                    ? `${items.length} source(s) in ${project.title}:\n${items.map((s) => `- ${s.title} [${s.type}, ${s.status}] ${s.url} (id: ${s.id}, ${s.documentCount} docs)`).join("\n")}`
                    : `${project.title} has no knowledge sources.`
                return mcpOk(summary, {sources: items})
            })
    )

    server.registerTool(
        "trigger_sync",
        {
            title: "Trigger knowledge sync",
            description: "Queues an immediate re-sync (re-crawl / re-index) of one source or all sources of a project. Requires sources:manage.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                source_id: z.string().min(1).optional().describe("Source id to sync; omit to sync all sources of the project")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}
        },
        ({project_id, source_id}) =>
            mcpSafely(ctx, "trigger_sync", async () => {
                const project = await mcpProject(ctx, project_id, "sources:manage")
                if (source_id) {
                    const {sources} = await useCollections()
                    const exists = await sources.countDocuments({_id: source_id, projectId: project._id})
                    if (!exists) throw new McpToolError(`Source "${source_id}" not found in project ${project.title}.`)
                }
                const queued = await requestSync(project._id, source_id)
                const summary = queued ? `Queued ${queued} source(s) of ${project.title} for sync.` : "Nothing queued: no sources found or they are already syncing."
                return mcpOk(summary, {queued})
            })
    )

    server.registerTool(
        "search_knowledge",
        {
            title: "Search knowledge",
            description: "Semantic search over a project's knowledge base (FAQ, websites, repos, Drive) using the same retrieval as the chat assistant. Returns documentId/faqId so you can inspect full documents or update FAQs.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                query: z.string().trim().min(1).max(2000).describe("What to search for (natural language)"),
                limit: z.number().int().min(1).max(20).default(5).describe("Max results (1-20, default 5)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, query, limit}) =>
            mcpSafely(ctx, "search_knowledge", async () => {
                const project = await mcpProject(ctx, project_id)
                const hits = await searchKnowledge(project._id, query, {limit})
                const items = hits.map((h) => ({
                    title: h.title,
                    url: h.url,
                    heading: h.heading,
                    sourceType: h.sourceType,
                    ...(h.sourceType === "faq" ? {faqId: h.documentId} : {documentId: h.documentId, sourceId: h.sourceId}),
                    score: Math.round(h.score * 1000) / 1000,
                    ...(h.score < RAG_MIN_SCORE ? {belowChatThreshold: true} : {}),
                    content: mcpTruncate(h.content, 2000)
                }))
                const summary = items.length
                    ? `${items.length} result(s) for "${query}" in ${project.title}:\n\n${items
                          .map((h, i) => {
                              const idNote = "faqId" in h ? `, faqId: ${h.faqId}` : `, documentId: ${h.documentId}`
                              const thresholdNote = h.belowChatThreshold ? ", below chat threshold" : ""
                              return `### ${i + 1}. ${h.title}${h.heading && h.heading !== h.title ? ` - ${h.heading}` : ""} (score ${h.score}${thresholdNote}${idNote})${h.url ? `\n${h.url}` : ""}\n${h.content}`
                          })
                          .join("\n\n")}`
                    : `No knowledge found for "${query}" in ${project.title}.`
                // Text already contains the hits; avoid duplicating them as JSON in the text content
                return {content: [{type: "text", text: summary}], structuredContent: {results: mcpJson(items)}}
            })
    )

    server.registerTool(
        "get_document",
        {
            title: "Get indexed document",
            description: `Returns the indexed Markdown of a document (web page, git file or Drive file) from \`search_knowledge\`, in slices of up to ${DOCUMENT_MAX_CHARS} characters. Pass the returned nextOffset as offset to read the next slice.`,
            inputSchema: {
                project_id: mcpProjectIdArg,
                document_id: z.string().min(1).describe("Document id (see search_knowledge)"),
                offset: z.number().int().min(0).default(0).describe("Character offset to start reading from (default 0)"),
                max_chars: z.number().int().min(1).max(DOCUMENT_MAX_CHARS).default(DOCUMENT_DEFAULT_CHARS).describe(`Max characters to return (1-${DOCUMENT_MAX_CHARS}, default ${DOCUMENT_DEFAULT_CHARS})`)
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, document_id, offset, max_chars}) =>
            mcpSafely(ctx, "get_document", async () => {
                const project = await mcpProject(ctx, project_id)
                const {documents} = await useCollections()
                const doc = await documents.findOne({_id: document_id, projectId: project._id})
                if (!doc) throw new McpToolError(`Document "${document_id}" not found in project ${project.title}.`)
                const markdown = doc.markdown ?? ""
                const totalChars = markdown.length
                const slice = markdown.slice(offset, offset + max_chars)
                const end = offset + slice.length
                const nextOffset = end < totalChars ? end : undefined
                const document = {
                    id: doc._id,
                    sourceId: doc.sourceId,
                    ref: doc.ref,
                    url: doc.url,
                    title: doc.title,
                    chunkCount: doc.chunkCount,
                    updatedAt: doc.updatedAt,
                    totalChars,
                    offset,
                    ...(nextOffset !== undefined ? {nextOffset} : {})
                }
                const header = `# ${doc.title || doc.ref}${doc.url ? `\nURL: ${doc.url}` : `\nRef: ${doc.ref}`}`
                const range = totalChars ? `\n\n[Characters ${offset}-${end} of ${totalChars}${nextOffset !== undefined ? `; call again with offset ${nextOffset} for the next slice` : ""}]` : ""
                // The Markdown is returned once, as text; structuredContent carries only the metadata and paging info
                return {content: [{type: "text", text: `${header}${range}\n\n${slice}`}], structuredContent: mcpJson({document})}
            })
    )

    server.registerTool(
        "list_faqs",
        {
            title: "List FAQ entries",
            description: "Lists FAQ entries of a project, optionally filtered by text.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                query: z.string().trim().max(200).optional().describe("Case-insensitive text filter on question and answer"),
                limit: z.number().int().min(1).max(200).default(50).describe("Max entries (1-200, default 50)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, query, limit}) =>
            mcpSafely(ctx, "list_faqs", async () => {
                const project = await mcpProject(ctx, project_id)
                const {faqs} = await useCollections()
                const filter: Record<string, any> = {projectId: project._id}
                if (query) {
                    const re = {$regex: mcpEscapeRegex(query), $options: "i"}
                    filter.$or = [{question: re}, {answer: re}]
                }
                const [list, total] = await Promise.all([faqs.find(filter).sort({updatedAt: -1}).limit(limit).toArray(), faqs.countDocuments(filter)])
                const items = list.map(faqView)
                const summary = items.length ? `${items.length} of ${total} FAQ entr${total === 1 ? "y" : "ies"} in ${project.title}${query ? ` matching "${query}"` : ""}.` : `No FAQ entries${query ? ` matching "${query}"` : ""} in ${project.title}.`
                return mcpOk(summary, {total, faqs: items})
            })
    )

    server.registerTool(
        "add_faq",
        {
            title: "Add FAQ entry",
            description: "Adds a question/answer pair to the project FAQ and indexes it so the chat assistant can use it. Requires sources:manage.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                question: z.string().trim().min(1).max(1000).describe("The question, phrased as a visitor would ask it"),
                answer: z.string().trim().min(1).max(20000).describe("The answer (markdown)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false}
        },
        ({project_id, question, answer}) =>
            mcpSafely(ctx, "add_faq", async () => {
                const project = await mcpProject(ctx, project_id, "sources:manage")
                const {faqs} = await useCollections()
                const now = new Date()
                const faq: Faq = {_id: newId(), projectId: project._id, question: faqTextToMarkdown(question), answer: faqTextToMarkdown(answer), createdAt: now, updatedAt: now}
                await faqs.insertOne(faq)
                const {indexed, warning} = await tryIndexFaq(faq)
                return mcpOk(indexed ? `FAQ entry added to ${project.title} (id: ${faq._id}).` : `FAQ entry added to ${project.title} (id: ${faq._id}). ${warning}`, {faq: faqView(faq), indexed, warning})
            })
    )

    server.registerTool(
        "update_faq",
        {
            title: "Update FAQ entry",
            description: "Updates an existing FAQ question and/or answer and re-indexes it. Requires sources:manage.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                faq_id: z.string().min(1).describe("FAQ id (see list_faqs or search_knowledge)"),
                question: z.string().trim().min(1).max(1000).optional().describe("Updated question text"),
                answer: z.string().trim().min(1).max(20000).optional().describe("Updated answer (markdown)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}
        },
        ({project_id, faq_id, question, answer}) =>
            mcpSafely(ctx, "update_faq", async () => {
                if (question === undefined && answer === undefined) throw new McpToolError("Provide at least one of question or answer to update.")
                const project = await mcpProject(ctx, project_id, "sources:manage")
                const {faqs} = await useCollections()
                const patch: Partial<Faq> = {updatedAt: new Date()}
                if (question !== undefined) patch.question = faqTextToMarkdown(question)
                if (answer !== undefined) patch.answer = faqTextToMarkdown(answer)
                return withFaqLock(faq_id, async () => {
                    const faq = await faqs.findOneAndUpdate({_id: faq_id, projectId: project._id}, {$set: patch}, {returnDocument: "after"})
                    if (!faq) throw new McpToolError(`FAQ "${faq_id}" not found in project ${project.title}.`)
                    const {indexed, warning} = await tryIndexFaq(faq)
                    // A failed re-index must not leave the previous answer searchable
                    if (!indexed) await removeFaqIndex(faq._id).catch((err) => logger.error("MCP.knowledge", `Could not drop stale FAQ index for ${faq._id}`, err))
                    return mcpOk(indexed ? `FAQ entry ${faq._id} updated.` : `FAQ entry ${faq._id} updated. ${warning}`, {faq: faqView(faq), indexed, warning})
                })
            })
    )

    server.registerTool(
        "delete_faq",
        {
            title: "Delete FAQ entry",
            description: "Deletes a FAQ entry and removes it from the vector index. Requires sources:manage.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                faq_id: z.string().min(1).describe("FAQ id (see list_faqs)")
            },
            annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: true}
        },
        ({project_id, faq_id}) =>
            mcpSafely(ctx, "delete_faq", async () => {
                const project = await mcpProject(ctx, project_id, "sources:manage")
                const {faqs, questions} = await useCollections()
                return withFaqLock(faq_id, async () => {
                    // The row goes last: if cleanup fails the entry still exists and the delete can simply be retried
                    const faq = await faqs.findOne({_id: faq_id, projectId: project._id}, {projection: {_id: 1}})
                    if (!faq) throw new McpToolError(`FAQ "${faq_id}" not found in project ${project.title}.`)
                    await removeFaqIndex(faq_id)
                    await questions.updateMany({projectId: project._id, faqId: faq_id}, {$unset: {faqId: ""}})
                    await faqs.deleteOne({_id: faq_id, projectId: project._id})
                    return mcpOk(`FAQ entry ${faq_id} deleted from ${project.title}.`, {faqId: faq_id, deleted: true})
                })
            })
    )
}
