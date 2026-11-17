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
            mcpSafely(ctx, "list_projects", async () => {
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
                const summary = items.length ? `${items.length} project(s):\n${items.map((p) => `- ${p.title} (id: ${p.id}) - ${p.openQuestions} open question(s)`).join("\n")}` : "You have no accessible projects."
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
            mcpSafely(ctx, "get_project", async () => {
                const project = await mcpProject(ctx, project_id)
                const canManageSources = hasProjectPermission(ctx.user, project._id, "sources:manage")
                const {sources, faqs, questions} = await useCollections()
                const [sourceList, sourceCount, faqCount, openQuestions] = await Promise.all([
                    canManageSources ? sources.find({projectId: project._id}).sort({createdAt: 1}).toArray() : Promise.resolve([]),
                    canManageSources ? Promise.resolve(0) : sources.countDocuments({projectId: project._id}),
                    faqs.countDocuments({projectId: project._id}),
                    questions.countDocuments({projectId: project._id, status: "open"})
                ])
                const totalSources = canManageSources ? sourceList.length : sourceCount
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
                        ingestDetail: projectIngestDetail(project),
                        botName: project.theme?.botName,
                        chatUrl: publicUrl("chat", `/chat/${project._id}`),
                        createdAt: project.createdAt,
                        updatedAt: project.updatedAt
                    },
                    sourceCount: totalSources,
                    ...(canManageSources
                        ? {
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
                              }))
                          }
                        : {}),
                    faqCount,
                    openQuestions,
                    permissions: projectPermissions(ctx.user, project._id)
                }
                return mcpOk(`${project.title} (${project.website}) - ${totalSources} source(s), ${faqCount} FAQ(s), ${openQuestions} open question(s).`, data)
            })
    )

    server.registerTool(
        "get_project_stats",
        {
            title: "Get project stats",
            description: "Usage aggregates for a project over the last N days: sessions, messages, latency, token cost, top cited sources, escalations and questions. Requires analytics:read.",
            inputSchema: {
                project_id: mcpProjectIdArg,
                days: z.number().int().min(1).max(365).default(7).describe("Number of days to look back (1-365, default 7)")
            },
            annotations: {readOnlyHint: true}
        },
        ({project_id, days}) =>
            mcpSafely(ctx, "get_project_stats", async () => {
                const project = await mcpProject(ctx, project_id, "analytics:read")
                const {sessions, messages, questions} = await useCollections()
                const to = new Date()
                const from = new Date(to.getTime() - days * 86400_000)
                const pid = project._id
                const inRange = {projectId: pid, createdAt: {$gte: from}}
                const [sessionCount, msgFacet, questionsCreated, questionsAnswered, openQuestions] = await Promise.all([
                    sessions.countDocuments(inRange),
                    messages
                        .aggregate<{
                            totals: Array<{
                                messages: number
                                userMessages: number
                                assistantMessages: number
                                answeredMessages: number
                                escalations: number
                                avgLatencyMs: number | null
                                cost: number
                                promptTokens: number
                                completionTokens: number
                            }>
                            topSources: Array<{_id: string; title?: string; url?: string; count: number}>
                        }>([
                            {$match: inRange},
                            {
                                $facet: {
                                    totals: [
                                        {
                                            $group: {
                                                _id: null,
                                                messages: {$sum: 1},
                                                userMessages: {$sum: {$cond: [{$eq: ["$role", "user"]}, 1, 0]}},
                                                assistantMessages: {$sum: {$cond: [{$eq: ["$role", "assistant"]}, 1, 0]}},
                                                answeredMessages: {$sum: {$cond: [{$and: [{$eq: ["$role", "assistant"]}, {$ne: ["$escalated", true]}]}, 1, 0]}},
                                                escalations: {$sum: {$cond: [{$eq: ["$escalated", true]}, 1, 0]}},
                                                avgLatencyMs: {$avg: {$cond: [{$eq: ["$role", "assistant"]}, "$latencyMs", null]}},
                                                cost: {$sum: {$ifNull: ["$usage.cost", 0]}},
                                                promptTokens: {$sum: {$ifNull: ["$usage.promptTokens", 0]}},
                                                completionTokens: {$sum: {$ifNull: ["$usage.completionTokens", 0]}}
                                            }
                                        }
                                    ],
                                    topSources: [
                                        {$match: {role: "assistant", "sources.0": {$exists: true}}},
                                        {$unwind: "$sources"},
                                        {$group: {_id: {$ifNull: ["$sources.url", "$sources.title"]}, title: {$first: "$sources.title"}, url: {$first: "$sources.url"}, count: {$sum: 1}}},
                                        {$sort: {count: -1}},
                                        {$limit: 8}
                                    ]
                                }
                            }
                        ])
                        .toArray(),
                    questions.countDocuments(inRange),
                    questions.countDocuments({projectId: pid, answeredAt: {$gte: from}}),
                    questions.countDocuments({projectId: pid, status: "open"})
                ])
                const mt = msgFacet[0]?.totals[0]
                const data = {
                    project: {id: pid, title: project.title},
                    range: {from, to, days},
                    sessions: sessionCount,
                    messages: mt?.messages ?? 0,
                    userMessages: mt?.userMessages ?? 0,
                    assistantMessages: mt?.assistantMessages ?? 0,
                    answeredMessages: mt?.answeredMessages ?? 0,
                    escalations: mt?.escalations ?? 0,
                    questionsCreated,
                    questionsAnswered,
                    openQuestions,
                    avgLatencyMs: mt?.avgLatencyMs != null ? Math.round(mt.avgLatencyMs) : null,
                    cost: mt?.cost ?? 0,
                    promptTokens: mt?.promptTokens ?? 0,
                    completionTokens: mt?.completionTokens ?? 0,
                    topSources: (msgFacet[0]?.topSources ?? []).map((s) => ({title: s.title || s.url || "Untitled", url: s.url, count: s.count}))
                }
                return mcpOk(
                    `${project.title}, last ${days} day(s): ${sessionCount} session(s), ${data.messages} message(s), ${data.escalations} escalation(s), ${questionsCreated} question(s) created, ${questionsAnswered} answered, ${openQuestions} open now.`,
                    data
                )
            })
    )
}
