<script setup lang="ts">
import type {SourceView, SyncRun} from "#shared/types"

const MAX_RUNS = 200

const open = defineModel<boolean>("open", {default: false})
const props = defineProps<{projectId: string; source: SourceView | null}>()

const {isAdmin} = useMe()

const runs = ref<SyncRun[]>([])
const total = ref(0)
const retentionDays = ref(0)
const loading = ref(false)
const loadError = ref("")

const description = computed(() => {
    if (!runs.value.length && !total.value) return undefined
    const parts = [`${total.value} run${total.value === 1 ? "" : "s"} in the last ${retentionDays.value} days`]
    if (runs.value.length) {
        const avg = runs.value.reduce((sum, r) => sum + r.durationMs, 0) / runs.value.length
        parts.push(`avg ${formatDuration(avg)}`)
    }
    return parts.join(" · ")
})

async function load() {
    if (!props.source) return
    loadError.value = ""
    loading.value = true
    try {
        const res = await $fetch<{runs: SyncRun[]; total: number; retentionDays: number}>(`/api/projects/${props.projectId}/sources/${props.source._id}/runs`)
        runs.value = res.runs
        total.value = res.total
        retentionDays.value = res.retentionDays
    } catch (err) {
        loadError.value = errorMessage(err)
    } finally {
        loading.value = false
    }
}

// Sources.vue keeps polling while a sync runs, so `source` refreshes live while the modal is open
watch(
    [open, () => props.source?._id, () => props.source?.lastSyncAt, () => props.source?.status],
    ([isOpen], [wasOpen, prevId]) => {
        if (!isOpen || !props.source) return
        if (!wasOpen || props.source._id !== prevId) {
            runs.value = []
            total.value = 0
        }
        load()
    },
    {immediate: true}
)

function statusInfo(run: SyncRun): {dot: string; label: string} {
    if (run.status === "failed") return {dot: "err", label: "Failed"}
    if (run.status === "partial") return {dot: "warn", label: "Warnings"}
    return {dot: "ok", label: "Success"}
}
</script>

<template>
    <UiModal v-model:open="open" :title="`Sync history · ${source?.title || 'Source'}`" :description="description" width="720px">
        <p v-if="source?.status === 'syncing' || source?.status === 'queued'" class="row small" style="--gap: 8px; margin-bottom: 12px"><span class="dot busy" /> {{ source.status === "syncing" ? "Syncing now…" : "Queued" }}</p>

        <div v-if="loading && !runs.length" class="stack" style="--gap: 8px">
            <div v-for="i in 4" :key="i" class="skeleton" style="height: 42px" />
        </div>

        <template v-else-if="loadError && !runs.length">
            <UiEmpty title="Could not load sync history" :description="loadError">
                <UiButton size="sm" @click="load()">Retry</UiButton>
            </UiEmpty>
        </template>

        <UiEmpty v-else-if="!runs.length" title="Nothing to show" :description="`No sync runs in the last ${retentionDays || '…'} days`" />

        <template v-else>
            <div class="table-wrap">
                <table class="table runs-table">
                    <thead>
                        <tr>
                            <th scope="col">Started</th>
                            <th scope="col">Result</th>
                            <th scope="col" class="num">Files</th>
                            <th scope="col" class="num">Size</th>
                            <th scope="col" class="num">Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="run in runs" :key="run._id">
                            <tr>
                                <td class="nowrap" :title="formatDate(run.startedAt, true)">{{ timeAgo(run.startedAt) }}</td>
                                <td class="nowrap">
                                    <span class="status"><span class="dot" :class="statusInfo(run).dot" /> {{ statusInfo(run).label }}</span>
                                </td>
                                <td class="num nowrap">
                                    <template v-if="run.documents !== undefined">
                                        <span class="strong">{{ formatNumber(run.documents) }}</span>
                                        <p v-if="run.changed || run.removed" class="dim tiny">{{ run.changed }} changed · {{ run.removed }} removed</p>
                                    </template>
                                    <span v-else class="dim">—</span>
                                </td>
                                <td class="num nowrap">{{ run.bytes !== undefined ? formatBytes(run.bytes) : "—" }}</td>
                                <td class="num nowrap">{{ formatDuration(run.durationMs) }}</td>
                            </tr>
                            <tr v-if="run.message" class="message-row">
                                <td colspan="5">
                                    <p class="tiny message" :class="run.status === 'failed' ? 'danger-text' : 'warn-text'">{{ run.message }}</p>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
            <p v-if="total > runs.length" class="dim tiny" style="margin-top: 8px">Showing the latest {{ MAX_RUNS }} of {{ formatNumber(total) }} runs.</p>
            <p class="dim tiny runs-foot">
                Runs are kept for {{ retentionDays }} day{{ retentionDays === 1 ? "" : "s" }}.
                <NuxtLink v-if="isAdmin" to="/admin/settings" @click="open = false">Change on Global Settings</NuxtLink>
            </p>
        </template>
    </UiModal>
</template>

<style scoped>
.status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}
.num {
    white-space: nowrap;
}
.message-row td {
    padding-top: 0;
}
.message {
    word-break: break-word;
}
.warn-text {
    color: var(--warning);
}
.runs-foot {
    margin-top: 10px;
}
.runs-foot a {
    color: var(--text-muted);
    text-decoration: underline;
}
.runs-foot a:hover {
    color: var(--text);
}
@media (max-width: 760px) {
    .runs-table thead {
        display: none;
    }
    .runs-table,
    .runs-table tbody,
    .runs-table tr,
    .runs-table td {
        display: block;
        width: 100%;
    }
    .runs-table tbody tr {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
    }
    .runs-table tbody tr:last-child {
        border-bottom: 0;
    }
    .runs-table td {
        padding: 2px 0;
        border: 0;
        text-align: left;
    }
    .runs-table .num {
        text-align: left;
    }
    .message-row td {
        padding-top: 0;
        padding-bottom: 10px;
    }
}
</style>
