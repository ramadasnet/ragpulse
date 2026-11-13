const DAY_MS = 86400_000

function dayKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "analytics:read")
    const query = getQuery(event)
    const days = Math.min(365, Math.max(1, Math.floor(Number(query.days) || 30)))

    const now = new Date()
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const from = new Date(todayUtc - (days - 1) * DAY_MS)
    const projectId = project._id
    const inRange = {projectId, createdAt: {$gte: from}}
    const byDay = {$dateToString: {format: "%Y-%m-%d", date: "$createdAt"}}

    const {sessions, messages, questions} = await useCollections()

    const [sessionDaily, messageFacet, questionFacet, openQuestions, recentQuestions] = await Promise.all([
        sessions.aggregate<{_id: string; n: number}>([{$match: inRange}, {$group: {_id: byDay, n: {$sum: 1}}}]).toArray(),
        messages
            .aggregate<{
                totals: Array<{messages: number; userMessages: number; assistantMessages: number; answered: number; avgLatencyMs: number | null; cost: number; promptTokens: number; completionTokens: number}>
                daily: Array<{_id: string; n: number}>
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
                                    answered: {$sum: {$cond: [{$and: [{$eq: ["$role", "assistant"]}, {$ne: ["$escalated", true]}]}, 1, 0]}},
                                    avgLatencyMs: {$avg: {$cond: [{$eq: ["$role", "assistant"]}, "$latencyMs", null]}},
                                    cost: {$sum: {$ifNull: ["$usage.cost", 0]}},
                                    promptTokens: {$sum: {$ifNull: ["$usage.promptTokens", 0]}},
                                    completionTokens: {$sum: {$ifNull: ["$usage.completionTokens", 0]}}
                                }
                            }
                        ],
                        daily: [{$group: {_id: byDay, n: {$sum: 1}}}],
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
        questions
            .aggregate<{totals: Array<{escalated: number; answered: number}>; daily: Array<{_id: string; n: number}>}>([
                {$match: inRange},
                {
                    $facet: {
                        totals: [{$group: {_id: null, escalated: {$sum: 1}, answered: {$sum: {$cond: [{$eq: ["$status", "answered"]}, 1, 0]}}}}],
                        daily: [{$group: {_id: byDay, n: {$sum: 1}}}]
                    }
                }
            ])
            .toArray(),
        questions.countDocuments({projectId, status: "open"}),
        questions.find({projectId, status: "open"}).sort({createdAt: -1}).limit(5).toArray()
    ])

    const msg = messageFacet[0]
    const mt = msg?.totals[0]
    const qt = questionFacet[0]?.totals[0]
    const sessionMap = new Map(sessionDaily.map((r) => [r._id, r.n]))
    const messageMap = new Map((msg?.daily ?? []).map((r) => [r._id, r.n]))
    const escalatedMap = new Map((questionFacet[0]?.daily ?? []).map((r) => [r._id, r.n]))

    const daily: Array<{date: string; sessions: number; messages: number; escalated: number}> = []
    for (let i = 0; i < days; i++) {
        const date = dayKey(new Date(from.getTime() + i * DAY_MS))
        daily.push({
            date,
            sessions: sessionMap.get(date) ?? 0,
            messages: messageMap.get(date) ?? 0,
            escalated: escalatedMap.get(date) ?? 0
        })
    }

    return {
        range: {from: from.toISOString(), to: now.toISOString(), days},
        totals: {
            sessions: daily.reduce((sum, d) => sum + d.sessions, 0),
            messages: mt?.messages ?? 0,
            userMessages: mt?.userMessages ?? 0,
            assistantMessages: mt?.assistantMessages ?? 0,
            answered: mt?.answered ?? 0,
            escalated: qt?.escalated ?? 0,
            openQuestions,
            answeredQuestions: qt?.answered ?? 0,
            avgLatencyMs: mt?.avgLatencyMs != null ? Math.round(mt.avgLatencyMs) : null,
            cost: mt?.cost ?? 0,
            promptTokens: mt?.promptTokens ?? 0,
            completionTokens: mt?.completionTokens ?? 0
        },
        daily,
        topSources: (msg?.topSources ?? []).map((s) => ({title: s.title || s.url || "Untitled", url: s.url, count: s.count})),
        recentQuestions
    }
})
