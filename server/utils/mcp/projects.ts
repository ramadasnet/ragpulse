import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {z} from "zod"
import {type McpContext, mcpOk, mcpProject, mcpSafely} from "./context"

export const mcpProjectIdArg = z.string().min(1).describe("Project id (see list_projects)")

export function registerMcpProjectTools(server: McpServer, ctx: McpContext) {
    server.registerTool(
        "list_projects",
        {
            title: "List projects",
            description: "Lists the projects (websites/apps with a support chat) you can access, with open question counts and your permissions.",
            inputSchema: {},
            annotations: {readOnlyHint: true}
        },
        () =>
            mcpSafely(async () => {
                const {projects, questions} = await useCollections()
                const ids = accessibleProjectIds(ctx.user)
                const list = await projects
                    .find(ids ? {_id: {$in: ids}} : {}, {projection: {_id: 1, title: 1, website: 1, model: 1, enabled: 1}})
                    .sort({title: 1})
                    .toArray()
                const open = await questions.aggregate<{_id: string; count: number}>([{$match: {status: "open", projectId: {$in: list.map((p) => p._id)}}}, {$group: {_id: "$projectId", count: {$sum: 1}}}]).toArray()
                const openBy = new Map(open.map((o) => [o._id, o.count]))
                const items = list.map((p) => ({
                    id: p._id,
                    title: p.title,
                    website: p.website,
                    model: p.model,
                    enabled: p.enabled,
                    openQuestions: openBy.get(p._id) ?? 0,
                    permissions: projectPermissions(ctx.user, p._id)
                }))
                const summary = items.length ? `${items.length} project(s):\n${items.map((p) => `- ${p.title} (id: ${p.id}) — ${p.openQuestions} open question(s)`).join("\n")}` : "You have no accessible projects."
                return mcpOk(summary, {projects: items})
            })
    )

    server.registerTool(
        "get_project",
        {
            title: "Get project",
            description: "Returns project details: settings, knowledge sources summary, FAQ count and chat URL.",
            inputSchema: {project_id: mcpProjectIdArg},
            annotations: {readOnlyHint: true}
        },
        ({project_id}) =>
            mcpSafely(async () => {
                const project = await mcpProject(ctx, project_id)
                const {sources, faqs, questions} = await useCollections()
                const [sourceList, faqCount, openQuestions] = await Promise.all([
                    sources.find({projectId: project._id}).sort({createdAt: 1}).toArray(),
                    faqs.countDocuments({projectId: project._id}),
                    questions.countDocuments({projectId: project._id, status: "open"})
                ])
                const data = {
                    project: {
                        id: project._id,
                        title: project.title,
                        website: project.website,
                        enabled: project.enabled,
                        model: project.model,
                        temperature: project.temperature,
                        systemInstructions: project.systemInstructions,
                        rateLimit: project.rateLimit,
                        supportEmail: project.supportEmail,
                        allowedDomains: project.allowedDomains,
                        refreshIntervalHours: project.refreshIntervalHours,
                        botName: project.theme?.botName,
                        chatUrl: publicUrl("chat", `/chat/${project._id}`),
                        createdAt: project.createdAt,
                        updatedAt: project.updatedAt
                    },
                    sources: sourceList.map(serializeSource).map((s) => ({
                        id: s._id,
                        type: s.type,
                        title: s.title,
                        url: s.url,
                        status: s.status,
                        lastSyncAt: s.lastSyncAt,
                        lastError: s.lastError,
                        documentCount: s.documentCount,
                        chunkCount: s.chunkCount
                    })),
                    faqCount,
                    openQuestions,
                    permissions: projectPermissions(ctx.user, project._id)
                }
                return mcpOk(`${project.title} (${project.website}) — ${sourceList.length} source(s), ${faqCount} FAQ(s), ${openQuestions} open question(s).`, data)
            })
    )

    server.registerTool(
        "get_project_stats",
        {
            title: "Get project stats",
            description: "Simple usage aggregates for a project over the last N days: sessions, messages, escalations and questions. Requires analytics:read.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                days: z.number().int().min(1).max(365).default(7).describe("Number of days to look back (1-365, default 7)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, days}) =>
            mcpSafely(async () => {
                const project = await mcpProject(ctx, project_id, "analytics:read")
                const {sessions, messages, questions} = await useCollections()
                const to = new Date()
                const from = new Date(to.getTime() - days * 86400_000)
                const pid = project._id
                const [sessionCount, messageCount, userMessages, escalatedMessages, questionsCreated, questionsAnswered, openQuestions] = await Promise.all([
                    sessions.countDocuments({projectId: pid, createdAt: {$gte: from}}),
                    messages.countDocuments({projectId: pid, createdAt: {$gte: from}}),
                    messages.countDocuments({projectId: pid, role: "user", createdAt: {$gte: from}}),
                    messages.countDocuments({projectId: pid, escalated: true, createdAt: {$gte: from}}),
                    questions.countDocuments({projectId: pid, createdAt: {$gte: from}}),
                    questions.countDocuments({projectId: pid, answeredAt: {$gte: from}}),
                    questions.countDocuments({projectId: pid, status: "open"})
                ])
                const data = {
                    project: {id: pid, title: project.title},
                    range: {from, to, days},
                    sessions: sessionCount,
                    messages: messageCount,
                    userMessages,
                    escalations: escalatedMessages,
                    questionsCreated,
                    questionsAnswered,
                    openQuestions
                }
                return mcpOk(
                    `${project.title}, last ${days} day(s): ${sessionCount} session(s), ${messageCount} message(s), ${escalatedMessages} escalation(s), ${questionsCreated} question(s) created, ${questionsAnswered} answered, ${openQuestions} open now.`,
                    data
                )
            })
    )
}
