<script setup lang="ts">
import {ArrowUpRight, ExternalLink, Inbox, MessagesSquare} from "lucide-vue-next"
import type {Question} from "#shared/types"

interface Analytics {
    range: {from: string; to: string; days: number}
    totals: {
        sessions: number
        messages: number
        userMessages: number
        assistantMessages: number
        answered: number
        escalated: number
        openQuestions: number
        answeredQuestions: number
        avgLatencyMs: number | null
        cost: number
        promptTokens: number
        completionTokens: number
    }
    daily: Array<{date: string; sessions: number; messages: number; escalated: number}>
    topSources: Array<{title: string; url?: string; count: number}>
    recentQuestions: Question[]
}

const projectId = useProjectId()
const {projects} = useProjects()
const {can} = useMe()
const allowed = await guardProjectPage(projectId.value!, "analytics:read")

const project = computed(() => projects.value.find((p) => p._id === projectId.value))
useHead({title: () => `${project.value?.title || "Overview"} · RAGPulse`})

const ranges = [7, 30, 90] as const
const days = ref<number>(30)

const {data, status, error} = useFetch<Analytics>(() => `/api/projects/${projectId.value}/analytics`, {
    query: {days},
    lazy: true,
    immediate: allowed,
    server: false
})

const totals = computed(() => data.value?.totals)
const answerRate = computed(() => {
    const t = totals.value
    if (!t || !t.assistantMessages) return "—"
    return `${Math.round((t.answered / t.assistantMessages) * 100)}%`
})
const latency = computed(() => {
    const ms = totals.value?.avgLatencyMs
    if (ms == null) return "—"
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})
const tokens = computed(() => (totals.value ? totals.value.promptTokens + totals.value.completionTokens : 0))
const topMax = computed(() => Math.max(1, ...(data.value?.topSources.map((s) => s.count) ?? [1])))

const NuxtLink = resolveComponent("NuxtLink")
const canReply = computed(() => can(projectId.value, "questions:reply"))

const reasonLabel: Record<string, string> = {low_confidence: "Low confidence", rate_limit: "Limit reached", user_request: "Asked for human", during_takeover: "During takeover"}
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Overview</p>
                <h1>{{ project?.title || "Project" }}</h1>
                <p>
                    How your assistant performed in the last {{ days }} days.
                    <a v-if="project?.website" :href="project.website" target="_blank" rel="noopener" class="site">{{ project.website.replace(/^https?:\/\//, "") }} <ExternalLink :size="12" /></a>
                </p>
            </div>
            <div class="seg" role="radiogroup" aria-label="Date range">
                <button v-for="r in ranges" :key="r" type="button" role="radio" :aria-checked="days === r" :class="{on: days === r}" @click="days = r">{{ r }}d</button>
            </div>
        </header>

        <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

        <template v-else>
            <div class="stats">
                <template v-if="totals">
                    <UiStat label="Conversations" :value="formatNumber(totals.sessions)" :hint="`${formatNumber(totals.userMessages)} visitor messages`" />
                    <UiStat label="Messages" :value="formatNumber(totals.messages)" :hint="`${formatNumber(totals.assistantMessages)} AI replies`" />
                    <UiStat label="Answer rate" :value="answerRate" tone="accent" hint="AI replies without escalation" />
                    <UiStat label="Escalations" :value="formatNumber(totals.escalated)" :hint="`${formatNumber(totals.answeredQuestions)} answered by humans`" />
                    <UiStat label="Open questions" :value="formatNumber(totals.openQuestions)" :tone="totals.openQuestions ? 'warning' : undefined" hint="Waiting for a reply" />
                    <UiStat label="Avg latency" :value="latency" hint="Time to full answer" />
                    <UiStat label="Cost" :value="formatCost(totals.cost)" hint="AI provider usage" />
                    <UiStat label="Tokens" :value="formatNumber(tokens)" :hint="`${formatNumber(totals.promptTokens)} in · ${formatNumber(totals.completionTokens)} out`" />
                </template>
                <template v-else>
                    <div v-for="i in 8" :key="i" class="panel stat-skel">
                        <div class="skeleton" style="width: 50%; height: 11px" />
                        <div class="skeleton" style="width: 40%; height: 26px" />
                    </div>
                </template>
            </div>

            <UiCard title="Activity" :description="`Daily conversations, messages and escalations (UTC)`" class="chart-card">
                <div v-if="status === 'pending' && !data" class="skeleton" style="height: 250px" />
                <AdminActivityChart v-else-if="data" :data="data.daily" />
            </UiCard>

            <div class="grid-2">
                <UiCard title="Top sources" description="Knowledge most often cited in answers">
                    <div v-if="!data" class="stack"><div v-for="i in 4" :key="i" class="skeleton" style="height: 18px" /></div>
                    <p v-else-if="!data.topSources.length" class="muted small">No cited sources yet in this period.</p>
                    <ol v-else class="sources">
                        <li v-for="s in data.topSources" :key="s.url || s.title">
                            <div class="row between" style="--gap: 12px">
                                <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="truncate source-link" :title="s.url">{{ s.title }}</a>
                                <span v-else class="truncate">{{ s.title }}</span>
                                <span class="small muted nowrap">{{ s.count }}</span>
                            </div>
                            <div class="meter"><span :style="{width: `${(s.count / topMax) * 100}%`}" /></div>
                        </li>
                    </ol>
                </UiCard>

                <UiCard title="Escalated questions" description="Latest open questions from visitors">
                    <template v-if="canReply" #actions>
                        <UiButton size="sm" variant="ghost" :to="`/admin/projects/${projectId}/questions`">Inbox <ArrowUpRight :size="14" /></UiButton>
                    </template>
                    <div v-if="!data" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 38px" /></div>
                    <div v-else-if="!data.recentQuestions.length" class="all-clear">
                        <Inbox :size="18" class="accent" />
                        <p class="muted small">All caught up — no open questions.</p>
                    </div>
                    <ul v-else class="questions">
                        <li v-for="q in data.recentQuestions" :key="q._id">
                            <component :is="canReply ? NuxtLink : 'div'" :to="`/admin/projects/${projectId}/questions?q=${q._id}`" class="question">
                                <p class="truncate">{{ q.question }}</p>
                                <p class="tiny dim row" style="--gap: 6px">
                                    <span class="truncate">{{ q.visitorName }}</span> · <span class="nowrap">{{ timeAgo(q.createdAt) }}</span> · <span class="nowrap">{{ reasonLabel[q.reason] }}</span>
                                </p>
                            </component>
                        </li>
                    </ul>
                </UiCard>
            </div>

            <div v-if="can(projectId, 'sessions:read')" class="row end">
                <UiButton variant="ghost" size="sm" :to="`/admin/projects/${projectId}/conversations`"><MessagesSquare :size="14" /> Browse conversations</UiButton>
            </div>
        </template>
    </div>
</template>

<style scoped>
.page > * + * {
    margin-top: 16px;
}
.site {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    margin-left: 6px;
}
.site:hover {
    color: var(--accent);
}
.seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.seg button {
    background: none;
    border: 0;
    padding: 5px 12px;
    border-radius: 7px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
}
.seg button:hover {
    color: var(--text);
}
.seg button.on {
    background: var(--surface-3);
    color: var(--text);
}
.stats {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
}
@media (max-width: 760px) {
    .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
.stat-skel {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 92px;
}
.sources,
.questions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.source-link:hover {
    color: var(--accent);
}
.meter {
    height: 4px;
    border-radius: 4px;
    background: var(--surface-2);
    margin-top: 6px;
    overflow: hidden;
}
.meter span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--violet), var(--accent));
    border-radius: 4px;
}
.questions {
    gap: 2px;
}
.question {
    display: block;
    padding: 8px 10px;
    margin: 0 -10px;
    border-radius: 8px;
}
a.question:hover {
    background: var(--surface-2);
}
.all-clear {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
}
</style>
