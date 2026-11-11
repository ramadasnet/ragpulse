<script setup lang="ts">
import {Activity, Cpu, Database, RefreshCw, Settings2} from "lucide-vue-next"

interface SystemStats {
    db: {name: string; dataSize: number; storageSize: number; indexSize: number; collections: number; objects: number}
    collections: Array<{name: string; count: number; size: number; storageSize: number; indexSize: number}>
    vectorMode: "atlas" | "fallback" | "unknown"
    embeddingModel: string
    embeddingDimensions: number
    embedding: {model: string; total: number; current: number}
    perProject: Array<{projectId: string; title: string; chunks: number; documents: number; sessions: number; messages: number; estimatedBytes: number}>
    config: {openrouter: boolean; smtp: boolean; google: boolean; microsoft: boolean; googleDrive: string | null; adminUrl: string; chatUrl: string}
    scheduler: {queued: number; syncing: number; errors: number; idle?: number; nextDue?: string}
}

const {isAdmin} = useMe()
if (!isAdmin.value) await navigateTo("/admin", {replace: true})
useHead({title: "System · RAGPulse"})

const {data, error, status, refresh} = useFetch<SystemStats>("/api/system/stats", {lazy: true, server: false, immediate: isAdmin.value})

const collections = computed(() => [...(data.value?.collections ?? [])].sort((a, b) => b.storageSize + b.indexSize - (a.storageSize + a.indexSize)))
const maxProjectBytes = computed(() => Math.max(1, ...(data.value?.perProject.map((p) => p.estimatedBytes) ?? [1])))
const maxCollectionBytes = computed(() => Math.max(1, ...collections.value.map((c) => c.storageSize + c.indexSize)))

const checks = computed(() => {
    const c = data.value?.config
    if (!c) return []
    const oauthAny = c.google || c.microsoft
    return [
        {label: "OpenRouter API key", ok: c.openrouter, level: c.openrouter ? "ok" : "err", hint: c.openrouter ? "Chat and embeddings are available." : "Set NUXT_OPENROUTER_API_KEY — chat and indexing will fail without it."},
        {label: "SMTP email", ok: c.smtp, level: c.smtp ? "ok" : "warn", hint: c.smtp ? "Escalations, replies and invites are emailed." : "Set NUXT_SMTP_PASS (Cloudflare API token) and NUXT_SMTP_FROM to email support, visitors and invitees."},
        {label: "Google sign-in", ok: c.google, level: c.google ? "ok" : oauthAny ? "warn" : "err", hint: c.google ? "Configured." : "Set NUXT_OAUTH_GOOGLE_CLIENT_ID / _CLIENT_SECRET."},
        {label: "Microsoft sign-in", ok: c.microsoft, level: c.microsoft ? "ok" : oauthAny ? "warn" : "err", hint: c.microsoft ? "Configured." : "Set NUXT_OAUTH_MICROSOFT_CLIENT_ID / _CLIENT_SECRET."},
        {label: "Google Drive", ok: !!c.googleDrive, level: c.googleDrive ? "ok" : "warn", hint: c.googleDrive ? `Share folders with ${c.googleDrive} (Viewer) to index them.` : "Set NUXT_GOOGLE_SERVICE_ACCOUNT_KEY to index Google Drive folders."},
        {label: "Admin URL", ok: !!c.adminUrl, level: c.adminUrl ? "ok" : "warn", hint: c.adminUrl || "Set NUXT_PUBLIC_ADMIN_URL so links in emails and the MCP endpoint are absolute."},
        {label: "Chat URL", ok: !!c.chatUrl, level: c.chatUrl ? "ok" : "warn", hint: c.chatUrl || "Set NUXT_PUBLIC_CHAT_URL so embed snippets and chat links point to the chat instance."}
    ]
})

const vector = computed(() => {
    const mode = data.value?.vectorMode
    if (mode === "atlas") {
        return {
            tone: "success" as const,
            label: "Atlas Vector Search",
            text: "Similarity search runs inside MongoDB with $vectorSearch on an indexed embedding field. Fast and scales to millions of chunks."
        }
    }
    if (mode === "fallback") {
        return {
            tone: "warning" as const,
            label: "In-app similarity (fallback)",
            text: "This MongoDB has no vector search, so RAGPulse loads a project's embeddings and computes cosine similarity in the app. Fine for small knowledge bases (a few thousand chunks). For scale, run the mongodb/mongodb-atlas-local image, MongoDB Atlas, or Community 8.2+ with mongot — the index is created automatically on startup."
        }
    }
    return {tone: "neutral" as const, label: "Unknown", text: "The database connection has not determined the vector search mode yet."}
})
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Workspace</p>
                <h1>System</h1>
                <p>Database usage, vector search, configuration health and the sync scheduler.</p>
            </div>
            <UiButton variant="secondary" :loading="status === 'pending' && !!data" @click="refresh()"><RefreshCw :size="14" /> Refresh</UiButton>
        </header>

        <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

        <div v-else-if="!data" class="stack" style="--gap: 16px">
            <div class="grid-4">
                <div v-for="i in 4" :key="i" class="panel stat-skel">
                    <div class="skeleton" style="width: 50%; height: 11px" />
                    <div class="skeleton" style="width: 40%; height: 26px" />
                </div>
            </div>
            <div class="panel panel-pad stack"><div v-for="i in 6" :key="i" class="skeleton" style="height: 16px" /></div>
        </div>

        <div v-else class="stack" style="--gap: 16px">
            <div class="grid-4">
                <UiStat label="Data size" :value="formatBytes(data.db.dataSize)" :hint="`${formatNumber(data.db.objects)} documents`" />
                <UiStat label="Storage" :value="formatBytes(data.db.storageSize)" hint="On disk (compressed)" />
                <UiStat label="Indexes" :value="formatBytes(data.db.indexSize)" :hint="`${data.db.collections} collections`" />
                <UiStat label="Database" :value="data.db.name" :hint="`Embeddings: ${data.embeddingDimensions} dims`" />
            </div>

            <div class="grid-2">
                <UiCard>
                    <template #header>
                        <div class="row" style="--gap: 8px">
                            <Cpu :size="16" class="dim" />
                            <h2 class="card-title">Vector search</h2>
                        </div>
                    </template>
                    <div class="stack" style="--gap: 12px">
                        <div class="row" style="--gap: 8px">
                            <UiBadge :tone="vector.tone">{{ vector.label }}</UiBadge>
                            <span class="mono tiny dim truncate" :title="data.embeddingModel">{{ data.embeddingModel }}</span>
                        </div>
                        <p class="small muted">{{ vector.text }}</p>
                        <p v-if="data.embedding.current < data.embedding.total" class="small warn-text">
                            Re-indexing after an embedding model change: {{ formatNumber(data.embedding.current) }} of {{ formatNumber(data.embedding.total) }} chunks done.
                        </p>
                        <NuxtLink to="/admin/settings" class="tiny accent">Change the embedding model in Settings</NuxtLink>
                    </div>
                </UiCard>

                <UiCard>
                    <template #header>
                        <div class="row" style="--gap: 8px">
                            <Activity :size="16" class="dim" />
                            <h2 class="card-title">Sync scheduler</h2>
                        </div>
                    </template>
                    <div class="sched">
                        <div>
                            <span class="dot" :class="data.scheduler.queued ? 'warn' : 'ok'" /><b>{{ data.scheduler.queued }}</b
                            ><span class="tiny dim">queued</span>
                        </div>
                        <div>
                            <span class="dot" :class="data.scheduler.syncing ? 'busy' : ''" /><b>{{ data.scheduler.syncing }}</b
                            ><span class="tiny dim">syncing</span>
                        </div>
                        <div>
                            <span class="dot" :class="data.scheduler.errors ? 'err' : 'ok'" /><b>{{ data.scheduler.errors }}</b
                            ><span class="tiny dim">errors</span>
                        </div>
                    </div>
                    <p class="small muted" style="margin-top: 12px">
                        Next scheduled refresh:
                        <strong class="text">{{ data.scheduler.nextDue ? `${timeAgo(data.scheduler.nextDue)} (${formatDate(data.scheduler.nextDue, true)})` : "none" }}</strong>
                    </p>
                </UiCard>
            </div>

            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <Settings2 :size="16" class="dim" />
                        <h2 class="card-title">Configuration health</h2>
                    </div>
                </template>
                <ul class="checks">
                    <li v-for="c in checks" :key="c.label">
                        <span class="dot" :class="c.level" />
                        <div class="grow">
                            <p class="strong small">{{ c.label }}</p>
                            <p class="tiny dim break">{{ c.hint }}</p>
                        </div>
                        <UiBadge :tone="c.ok ? 'success' : c.level === 'err' ? 'danger' : 'warning'">{{ c.ok ? "OK" : "Missing" }}</UiBadge>
                    </li>
                </ul>
            </UiCard>

            <UiCard title="Usage by project" description="Estimated from document counts and average document sizes" :pad="false">
                <p v-if="!data.perProject.length" class="muted small" style="padding: 20px">No projects yet.</p>
                <ul v-else class="projects">
                    <li v-for="p in data.perProject" :key="p.projectId">
                        <div class="row between" style="--gap: 12px">
                            <NuxtLink :to="`/admin/projects/${p.projectId}`" class="strong truncate plink">{{ p.title }}</NuxtLink>
                            <span class="small muted nowrap">{{ formatBytes(p.estimatedBytes) }}</span>
                        </div>
                        <div class="bar"><span :style="{width: `${Math.max(1, (p.estimatedBytes / maxProjectBytes) * 100)}%`}" /></div>
                        <p class="tiny dim">{{ formatNumber(p.chunks) }} chunks · {{ formatNumber(p.documents) }} documents · {{ formatNumber(p.sessions) }} conversations · {{ formatNumber(p.messages) }} messages</p>
                    </li>
                </ul>
            </UiCard>

            <UiCard :pad="false">
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <Database :size="16" class="dim" />
                        <h2 class="card-title">Collections</h2>
                    </div>
                </template>
                <div class="coll-wrap">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Collection</th>
                                <th class="num">Documents</th>
                                <th class="num">Data</th>
                                <th class="num">Storage</th>
                                <th class="num">Indexes</th>
                                <th class="hide-sm" style="width: 22%"><span class="sr-only">Share</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="c in collections" :key="c.name">
                                <td class="mono small">{{ c.name }}</td>
                                <td class="num">{{ formatNumber(c.count) }}</td>
                                <td class="num">{{ formatBytes(c.size) }}</td>
                                <td class="num">{{ formatBytes(c.storageSize) }}</td>
                                <td class="num">{{ formatBytes(c.indexSize) }}</td>
                                <td class="hide-sm">
                                    <div class="bar thin"><span :style="{width: `${((c.storageSize + c.indexSize) / maxCollectionBytes) * 100}%`}" /></div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </UiCard>
        </div>
    </div>
</template>

<style scoped>
.card-title {
    font-size: 15px;
}
.stat-skel {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 92px;
}
.sched {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}
.sched > div {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.sched b {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
}
.warn-text {
    color: var(--warning);
}
.text {
    color: var(--text);
    font-weight: 500;
}
.checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 10px;
}
.checks li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
}
.break {
    word-break: break-word;
}
.projects {
    list-style: none;
    margin: 0;
    padding: 0;
}
.projects li {
    padding: 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.projects li + li {
    border-top: 1px solid var(--border);
}
.plink:hover {
    color: var(--accent);
}
.bar {
    height: 6px;
    border-radius: 6px;
    background: var(--surface-2);
    overflow: hidden;
}
.bar.thin {
    height: 4px;
}
.bar span {
    display: block;
    height: 100%;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--accent), var(--violet));
}
.coll-wrap {
    overflow-x: auto;
}
.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
@media (max-width: 720px) {
    .hide-sm {
        display: none;
    }
    .sched {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
