<script setup lang="ts">
import { ChevronDown, FileText, GitBranch, Globe, HardDrive, History, Library, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { SourceView } from '#shared/types'

const props = defineProps<{ projectId: string }>()

const { projects, refresh: refreshProjects } = useProjects()
const { confirm } = useConfirm()
const { run } = useAction()
const toast = useToast()

const { data, refresh, status, error } = useFetch<SourceView[]>(() => `/api/projects/${props.projectId}/sources`, { lazy: true, default: () => [] })
const sources = computed(() => data.value ?? [])

const projectHours = computed(() => projects.value.find(p => p._id === props.projectId)?.refreshIntervalHours ?? 48)

const busy = computed(() => sources.value.some(s => s.status === 'queued' || s.status === 'syncing'))
let poll: ReturnType<typeof setInterval> | undefined
watch(busy, (isBusy, wasBusy) => {
  if (isBusy && !poll) {
    poll = setInterval(() => refresh(), 3000)
  }
  else if (!isBusy) {
    clearInterval(poll)
    poll = undefined
    if (wasBusy) refreshProjects().catch(() => {})
  }
}, { immediate: true })
onBeforeUnmount(() => clearInterval(poll))

const modalOpen = ref(false)
const editing = ref<SourceView | null>(null)
const docsOpen = ref(false)
const docsSource = ref<SourceView | null>(null)
const historyOpen = ref(false)
const historyId = ref<string | null>(null)
const historySource = computed(() => sources.value.find(s => s._id === historyId.value) ?? null)
const expanded = ref<Set<string>>(new Set())
const syncing = ref<Set<string>>(new Set())

function add() {
  editing.value = null
  modalOpen.value = true
}
function edit(s: SourceView) {
  editing.value = s
  modalOpen.value = true
}
function showDocs(s: SourceView) {
  docsSource.value = s
  docsOpen.value = true
}
function showHistory(s: SourceView) {
  historyId.value = s._id
  historyOpen.value = true
}
function toggleError(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

async function onSaved() {
  await refresh()
  refreshProjects().catch(() => {})
}

async function syncNow(s: SourceView) {
  syncing.value = new Set(syncing.value).add(s._id)
  const res = await run(() => $fetch<{ queued: number, alreadySyncing: boolean }>(`/api/projects/${props.projectId}/sources/${s._id}/sync`, { method: 'POST' }))
  const next = new Set(syncing.value)
  next.delete(s._id)
  syncing.value = next
  if (!res) return
  if (res.alreadySyncing) toast.info('This source is already syncing')
  else toast.success('Sync queued')
  await refresh()
}

async function remove(s: SourceView) {
  const ok = await confirm({
    title: 'Delete source?',
    message: `“${s.title}” and its ${formatNumber(s.documentCount)} documents / ${formatNumber(s.chunkCount)} chunks will be removed from the knowledge base.`,
    confirmLabel: 'Delete source',
    danger: true
  })
  if (!ok) return
  const res = await run(() => $fetch<{ ok: boolean }>(`/api/projects/${props.projectId}/sources/${s._id}` as string, { method: 'DELETE' }), 'Source deleted')
  if (res) {
    data.value = sources.value.filter(x => x._id !== s._id)
    refreshProjects().catch(() => {})
  }
}

function statusInfo(s: SourceView): { dot: string, label: string } {
  if (s.status === 'syncing') return { dot: 'busy', label: 'Syncing…' }
  if (s.status === 'queued') return { dot: 'busy', label: 'Queued' }
  if (s.status === 'error') return { dot: 'err', label: 'Failed' }
  if (s.lastError) return { dot: 'warn', label: 'Synced with warnings' }
  return { dot: 'ok', label: 'Synced' }
}

function refreshLabel(s: SourceView) {
  return s.refreshIntervalHours == null
    ? { kind: 'inherits project', every: capitalize(formatHours(projectHours.value)) }
    : { kind: 'custom', every: capitalize(formatHours(s.refreshIntervalHours)) }
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

defineExpose({ refresh })
</script>

<template>
  <section class="stack" style="--gap: 14px">
    <div class="row between wrap">
      <p class="muted small">Websites, repositories and Google Drive folders are fetched, converted to markdown and re-indexed on a schedule.</p>
      <UiButton v-if="sources.length" variant="secondary" size="sm" @click="add"><Plus :size="15" /> Add source</UiButton>
    </div>

    <div v-if="status === 'pending' && !sources.length" class="stack" style="--gap: 8px">
      <div v-for="i in 3" :key="i" class="skeleton" style="height: 58px" />
    </div>

    <UiEmpty v-else-if="error" title="Could not load sources" :description="errorMessage(error)">
      <UiButton size="sm" @click="refresh()">Retry</UiButton>
    </UiEmpty>

    <UiEmpty
      v-else-if="!sources.length"
      :icon="Library"
      title="No sources yet"
      description="Add your website, help center or docs repository. Pages are converted to clean markdown, chunked and embedded for retrieval."
    >
      <UiButton variant="primary" @click="add"><Plus :size="15" /> Add source</UiButton>
    </UiEmpty>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Status</th>
            <th class="num">Content</th>
            <th>Schedule</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="s in sources" :key="s._id">
            <tr>
              <td class="src-cell">
                <div class="row" style="--gap: 12px; min-width: 0">
                  <span class="type-icon" :class="`type-${s.type}`" :title="s.type === 'git' ? 'Git repository' : s.type === 'drive' ? 'Google Drive folder' : 'Website'">
                    <GitBranch v-if="s.type === 'git'" :size="16" />
                    <HardDrive v-else-if="s.type === 'drive'" :size="16" />
                    <Globe v-else :size="16" />
                  </span>
                  <div class="grow" style="min-width: 0">
                    <p class="strong truncate">{{ s.title }}</p>
                    <a :href="s.url" target="_blank" rel="noopener" class="dim tiny truncate src-url">
                      {{ displayUrl(s.url) }}<template v-if="s.type === 'git' && s.options.branch"> · {{ s.options.branch }}</template><template v-if="s.type === 'url' && s.options.crawl"> · crawl ≤ {{ s.options.maxPages ?? 25 }}</template>
                    </a>
                  </div>
                </div>
              </td>
              <td class="nowrap">
                <button
                  v-if="s.lastError && s.status !== 'syncing' && s.status !== 'queued'"
                  type="button"
                  class="status as-button"
                  :title="s.lastError"
                  :aria-expanded="expanded.has(s._id)"
                  @click="toggleError(s._id)"
                >
                  <span class="dot" :class="statusInfo(s).dot" /> {{ statusInfo(s).label }}
                  <ChevronDown :size="13" class="chev" :class="{ open: expanded.has(s._id) }" />
                </button>
                <span v-else class="status"><span class="dot" :class="statusInfo(s).dot" /> {{ statusInfo(s).label }}</span>
              </td>
              <td class="num nowrap">
                <span class="strong">{{ formatNumber(s.documentCount) }}</span> <span class="dim small">{{ s.documentCount === 1 ? 'doc' : 'docs' }}</span>
                <span class="dim"> · </span>
                <span class="strong">{{ formatNumber(s.chunkCount) }}</span> <span class="dim small">{{ s.chunkCount === 1 ? 'chunk' : 'chunks' }}</span>
              </td>
              <td class="nowrap small">
                <span :title="s.lastSyncAt ? formatDate(s.lastSyncAt, true) : undefined">{{ s.lastSyncAt ? `Synced ${timeAgo(s.lastSyncAt)}` : 'Never synced' }}</span>
                <span v-if="s.lastDurationMs" class="dim tiny"> · {{ (s.lastDurationMs / 1000).toFixed(1) }}s</span>
                <p class="dim tiny" :title="s.status !== 'syncing' && s.status !== 'queued' && s.nextSyncAt ? `Next sync ${timeAgo(s.nextSyncAt)}` : undefined">
                  {{ refreshLabel(s).every }} · {{ refreshLabel(s).kind }}
                </p>
              </td>
              <td class="actions">
                <UiButton size="sm" variant="ghost" icon :aria-label="`Sync ${s.title} now`" title="Sync now" :disabled="s.status === 'syncing' || s.status === 'queued'" :loading="syncing.has(s._id)" @click="syncNow(s)">
                  <RefreshCw :size="15" :class="{ spin: s.status === 'syncing' }" />
                </UiButton>
                <UiButton size="sm" variant="ghost" icon :aria-label="`Documents of ${s.title}`" title="Documents" @click="showDocs(s)"><FileText :size="15" /></UiButton>
                <UiButton size="sm" variant="ghost" icon :aria-label="`Sync history of ${s.title}`" title="Sync history" @click="showHistory(s)"><History :size="15" /></UiButton>
                <UiButton size="sm" variant="ghost" icon :aria-label="`Edit ${s.title}`" title="Edit" @click="edit(s)"><Pencil :size="15" /></UiButton>
                <UiButton size="sm" variant="ghost" icon :aria-label="`Delete ${s.title}`" title="Delete" @click="remove(s)"><Trash2 :size="15" /></UiButton>
              </td>
            </tr>
            <tr v-if="s.lastError && expanded.has(s._id)" class="error-row">
              <td colspan="5">
                <p class="small" :class="s.status === 'error' ? 'danger-text' : 'warn-text'">{{ s.lastError }}</p>
                <p v-if="s.status === 'error'" class="dim tiny">Existing knowledge from this source is kept. Retrying {{ timeAgo(s.nextSyncAt) }}.</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <KnowledgeSourceModal v-model:open="modalOpen" :project-id="projectId" :source="editing" :project-hours="projectHours" @saved="onSaved" />
    <KnowledgeDocumentsModal v-model:open="docsOpen" :project-id="projectId" :source="docsSource" />
    <KnowledgeSyncHistoryModal v-model:open="historyOpen" :project-id="projectId" :source="historySource" />
  </section>
</template>

<style scoped>
.src-cell { min-width: 200px; max-width: 360px; }
.type-icon { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; flex-shrink: 0; background: var(--accent-soft); color: var(--accent); }
.type-icon.type-git { background: var(--violet-soft); color: var(--violet); }
.type-icon.type-drive { background: var(--info-soft); color: var(--info); }
.type-icon > svg { display: block; }
.src-url { display: block; }
.src-url:hover { color: var(--text-muted); text-decoration: underline; }
.status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.as-button { background: none; border: 0; padding: 2px 4px; margin: -2px -4px; border-radius: 6px; color: inherit; }
.as-button:hover { background: var(--surface-2); }
.chev { color: var(--text-dim); transition: transform 0.15s var(--ease); }
.chev.open { transform: rotate(180deg); }
.num { white-space: nowrap; }
.error-row td { background: var(--bg-elev); padding-top: 10px; padding-bottom: 12px; }
.error-row p { word-break: break-word; }
.warn-text { color: var(--warning); }
.spin { animation: spin 1s linear infinite; }
@media (max-width: 760px) {
  .table thead { display: none; }
  .table, .table tbody, .table tr, .table td { display: block; width: 100%; }
  .table tbody tr { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .table tbody tr:last-child { border-bottom: 0; }
  .table td { padding: 3px 0; border: 0; }
  .src-cell { min-width: 0; max-width: none; padding-bottom: 8px !important; }
  .table td.actions { text-align: left; padding-top: 6px; margin-left: -6px; }
  .error-row td { background: none; }
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
