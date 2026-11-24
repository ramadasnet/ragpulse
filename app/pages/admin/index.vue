<script setup lang="ts">
import {Activity, ArrowUpRight, FolderKanban, Headphones, Inbox, MessagesSquare, Plus, RefreshCw} from "lucide-vue-next"

useHead({title: "Dashboard · RAGPulse"})

const {isAdmin} = useMe()
const {data, error, status, refresh} = useFetch("/api/dashboard", {lazy: true, server: false})

const syncStatus = {
    success: {label: "Success", tone: "success"},
    partial: {label: "Warnings", tone: "warning"},
    failed: {label: "Failed", tone: "danger"}
} as const
</script>

<template>
    <div class="page">
        <header class="dashboard-head panel">
            <div>
                <p class="eyebrow"><Activity :size="15" /> Workspace overview</p>
                <h1>Dashboard</h1>
                <p class="muted">Support activity and knowledge syncs across your projects.</p>
            </div>
            <UiButton v-if="isAdmin" variant="secondary" to="/admin/projects/new"><Plus :size="16" /> New project</UiButton>
        </header>

        <UiEmpty v-if="error" :icon="Activity" title="Could not load dashboard" :description="errorMessage(error)">
            <UiButton size="sm" @click="refresh()">Try again</UiButton>
        </UiEmpty>
        <div v-else-if="!data" class="metrics" role="status">
            <span class="sr-only">Loading dashboard</span>
            <div v-for="i in 5" :key="i" class="panel skeleton" style="height: 102px" />
        </div>
        <template v-else>
            <section class="metrics" aria-label="Workspace totals" :aria-busy="status === 'pending'">
                <NuxtLink to="/admin/projects" class="panel metric metric-link">
                    <span class="metric-label"><FolderKanban :size="15" /> Projects <ArrowUpRight :size="13" class="metric-arrow" /></span>
                    <strong>{{ formatNumber(data.projects.total) }}</strong>
                    <span class="dim small">{{ formatNumber(data.projects.enabled) }} enabled</span>
                </NuxtLink>
                <div v-if="data.questions" class="panel metric questions">
                    <span class="metric-label"><Inbox :size="15" /> Open questions</span>
                    <strong>{{ formatNumber(data.questions.total) }}</strong>
                    <span class="dim small">Awaiting resolution</span>
                </div>
                <div v-if="data.conversations" class="panel metric conversations">
                    <span class="metric-label"><MessagesSquare :size="15" /> New conversations</span>
                    <strong>{{ formatNumber(data.conversations.started7d) }}</strong>
                    <span class="dim small">Started in the last 7 days</span>
                </div>
                <div v-if="data.conversations" class="panel metric human">
                    <span class="metric-label"><Headphones :size="15" /> Human-handled</span>
                    <strong>{{ formatNumber(data.conversations.humanHandled) }}</strong>
                    <span class="dim small">Unfinished, open chats</span>
                </div>
                <div v-if="data.syncs" class="panel metric syncs">
                    <span class="metric-label"><RefreshCw :size="15" /> Failed syncs</span>
                    <strong>{{ formatNumber(data.syncs.failed7d) }}</strong>
                    <span class="dim small">Runs in the last {{ data.syncs.windowDays === 1 ? "day" : `${data.syncs.windowDays} days` }}</span>
                </div>
            </section>

            <UiEmpty
                v-if="!data.projects.total"
                :icon="FolderKanban"
                :title="isAdmin ? 'Create your first project' : 'No projects yet'"
                :description="isAdmin ? 'Add a project to start tracking conversations, escalations and knowledge syncs.' : 'Ask an admin to give you access to a project.'"
            />
            <UiEmpty v-else-if="!data.questions && !data.conversations && !data.syncs" :icon="Activity" title="No activity feeds available" description="You can only see activity you have permission to access." />
            <div v-else class="activity-grid">
                <UiCard v-if="data.questions" class="feed questions" :pad="false">
                    <template #header>
                        <div class="feed-head">
                            <span class="feed-icon"><Inbox :size="18" /></span>
                            <div>
                                <h2>Open questions</h2>
                                <p class="dim small">Latest unresolved escalations</p>
                            </div>
                        </div>
                    </template>
                    <p v-if="!data.questions.items.length" class="feed-empty muted small">No open questions. You're all caught up.</p>
                    <ul v-else class="divider-list activity-list">
                        <li v-for="item in data.questions.items" :key="item._id">
                            <NuxtLink class="activity-link" :to="{path: `/admin/projects/${item.projectId}/questions`, query: {q: item._id}}">
                                <span class="entry">
                                    <strong class="entry-title">{{ item.question }}</strong>
                                    <span class="entry-meta dim small"
                                        ><span class="truncate">{{ item.projectTitle }}</span
                                        ><span aria-hidden="true">·</span><time :datetime="item.createdAt" :title="formatDate(item.createdAt, true)">{{ timeAgo(item.createdAt) }}</time></span
                                    >
                                </span>
                                <ArrowUpRight :size="15" class="entry-arrow" />
                            </NuxtLink>
                        </li>
                    </ul>
                </UiCard>

                <UiCard v-if="data.conversations" class="feed conversations" :pad="false">
                    <template #header>
                        <div class="feed-head">
                            <span class="feed-icon"><MessagesSquare :size="18" /></span>
                            <div>
                                <h2>Recent conversations</h2>
                                <p class="dim small">By latest message</p>
                            </div>
                        </div>
                    </template>
                    <p v-if="!data.conversations.items.length" class="feed-empty muted small">No conversations yet.</p>
                    <ul v-else class="divider-list activity-list">
                        <li v-for="item in data.conversations.items" :key="item._id">
                            <NuxtLink class="activity-link" :to="`/admin/projects/${item.projectId}/conversations/${item._id}`">
                                <span class="entry">
                                    <strong class="entry-title">{{ item.visitorName || "Visitor" }}</strong>
                                    <span class="entry-meta dim small"
                                        ><span class="truncate">{{ item.projectTitle }}</span
                                        ><span aria-hidden="true">·</span><time :datetime="item.lastMessageAt" :title="formatDate(item.lastMessageAt, true)">{{ timeAgo(item.lastMessageAt) }}</time></span
                                    >
                                </span>
                                <UiBadge v-if="item.finishedAt" tone="success">Finished</UiBadge>
                                <UiBadge v-else-if="item.endedAt">Ended</UiBadge>
                                <UiBadge v-else-if="item.humanHandledAt" tone="info">Human</UiBadge>
                                <ArrowUpRight :size="15" class="entry-arrow" />
                            </NuxtLink>
                        </li>
                    </ul>
                </UiCard>

                <UiCard v-if="data.syncs" class="feed syncs" :pad="false">
                    <template #header>
                        <div class="feed-head">
                            <span class="feed-icon"><RefreshCw :size="18" /></span>
                            <div>
                                <h2>Recent syncs</h2>
                                <p class="dim small">Latest completed knowledge runs</p>
                            </div>
                        </div>
                    </template>
                    <p v-if="!data.syncs.items.length" class="feed-empty muted small">No knowledge syncs yet.</p>
                    <ul v-else class="divider-list activity-list">
                        <li v-for="item in data.syncs.items" :key="item._id">
                            <NuxtLink class="activity-link" :to="{path: `/admin/projects/${item.projectId}/knowledge`, query: {history: item.sourceId}}">
                                <span class="entry">
                                    <strong class="entry-title">{{ item.title }}</strong>
                                    <span class="entry-meta dim small"
                                        ><span class="truncate">{{ item.projectTitle }}</span
                                        ><span aria-hidden="true">·</span><time :datetime="item.startedAt" :title="formatDate(item.startedAt, true)">{{ timeAgo(item.startedAt) }}</time></span
                                    >
                                </span>
                                <UiBadge :tone="syncStatus[item.status].tone">{{ syncStatus[item.status].label }}</UiBadge>
                                <ArrowUpRight :size="15" class="entry-arrow" />
                            </NuxtLink>
                        </li>
                    </ul>
                </UiCard>
            </div>
        </template>
    </div>
</template>

<style scoped>
.dashboard-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: clamp(18px, 3vw, 30px);
    margin-bottom: 16px;
    background: radial-gradient(ellipse at top right, var(--accent-soft), transparent 65%), var(--bg-elev);
}
.dashboard-head h1 {
    font-size: clamp(28px, 4vw, 42px);
    margin: 3px 0 5px;
}
.eyebrow {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
}
.metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
    gap: 10px;
    margin-bottom: 20px;
}
.metric {
    display: grid;
    align-content: start;
    gap: 4px;
    padding: 13px 14px;
}
.metric strong {
    font-size: 24px;
    font-variant-numeric: tabular-nums;
}
.metric-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
}
.metric-label > svg {
    flex: none;
    color: var(--lane, var(--accent));
}
.metric-arrow {
    margin-left: auto;
}
.questions {
    --lane: var(--warning);
    --lane-soft: var(--warning-soft);
}
.conversations {
    --lane: var(--info);
    --lane-soft: var(--info-soft);
}
.human {
    --lane: var(--violet);
}
.syncs {
    --lane: var(--accent);
    --lane-soft: var(--accent-soft);
}
.metric.syncs {
    --lane: var(--danger);
}
.activity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr));
    align-items: start;
    gap: 14px;
}
.feed-head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.feed-head h2 {
    font-size: 15px;
}
.feed-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: var(--lane);
    background: var(--lane-soft);
}
.feed-empty {
    padding: 18px 20px;
}
.activity-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.activity-link {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 61px;
    padding: 10px 14px;
}
.activity-link:hover,
.activity-link:focus-visible,
.metric-link:hover,
.metric-link:focus-visible {
    background: var(--surface-2);
}
.entry {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
}
.entry-title {
    display: -webkit-box;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: 13px;
}
.entry-meta {
    display: flex;
    gap: 5px;
}
.entry-meta time {
    white-space: nowrap;
}
.entry-arrow {
    flex: none;
    color: var(--text-dim);
}
.activity-link:hover .entry-arrow,
.activity-link:focus-visible .entry-arrow {
    color: var(--lane);
}
</style>
