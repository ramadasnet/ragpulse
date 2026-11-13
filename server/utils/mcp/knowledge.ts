import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import type {Faq} from "#shared/types"
import {type McpContext, McpToolError, mcpEscapeRegex, mcpOk, mcpProject, mcpSafely, mcpTruncate} from "./context"
import {mcpProjectIdArg} from "./projects"
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
            mcpSafely(async () => {
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
            mcpSafely(async () => {
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
            description: "Semantic search over a project's knowledge base (FAQ, websites, repos) — the same retrieval the chat assistant uses. Use it to research answers before replying to visitors.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                query: z.string().trim().min(1).max(2000).describe("What to search for (natural language)"),
                limit: z.number().int().min(1).max(20).default(5).describe("Max results (1-20, default 5)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, query, limit}) =>
            mcpSafely(async () => {
                const project = await mcpProject(ctx, project_id)
                const hits = await searchKnowledge(project._id, query, {limit})
                const items = hits.map((h) => ({
                    title: h.title,
                    url: h.url,
                    heading: h.heading,
                    sourceType: h.sourceType,
                    score: Math.round(h.score * 1000) / 1000,
                    content: mcpTruncate(h.content, 2000)
                }))
                const summary = items.length
                    ? `${items.length} result(s) for "${query}" in ${project.title}:\n\n${items.map((h, i) => `### ${i + 1}. ${h.title}${h.heading && h.heading !== h.title ? ` — ${h.heading}` : ""} (score ${h.score})${h.url ? `\n${h.url}` : ""}\n${h.content}`).join("\n\n")}`
                    : `No knowledge found for "${query}" in ${project.title}.`
                // Text already contains the hits; avoid duplicating them as JSON in the text content
                return {content: [{type: "text", text: summary}], structuredContent: {results: JSON.parse(JSON.stringify(items))}}
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
            mcpSafely(async () => {
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
                question: z.string().trim().min(3).max(1000).describe("The question, phrased as a visitor would ask it"),
                answer: z.string().trim().min(1).max(8000).describe("The answer (markdown)")
            },
            annotations: {readOnlyHint: false, destructiveHint: false}
        },
        ({project_id, question, answer}) =>
            mcpSafely(async () => {
                const project = await mcpProject(ctx, project_id, "sources:manage")
                const {faqs} = await useCollections()
                const now = new Date()
                const faq: Faq = {_id: newId(), projectId: project._id, question, answer, createdAt: now, updatedAt: now}
                await faqs.insertOne(faq)
                let indexed = true
                let warning: string | undefined
                try {
                    await indexFaq(faq)
                } catch (err: any) {
                    indexed = false
                    warning = `FAQ saved but indexing failed: ${err?.message || err}`
                    logger.error("MCP.knowledge", `FAQ indexing failed for ${faq._id}`, err)
                }
                return mcpOk(indexed ? `FAQ entry added to ${project.title} (id: ${faq._id}).` : `FAQ entry added to ${project.title} (id: ${faq._id}). ${warning}`, {faq: faqView(faq), indexed, warning})
            })
    )
}
