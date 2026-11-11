<script setup lang="ts">
import { ArrowLeft, ExternalLink, FileText, Search } from 'lucide-vue-next'
import type { DocumentRecord } from '#shared/types'

interface DocSummary {
  _id: string
  ref: string
  url?: string
  title: string
  chunkCount: number
  updatedAt: string
  size: number
}

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string, source: { _id: string, title: string, type: string } | null }>()

const docs = ref<DocSummary[]>([])
const loading = ref(false)
const loadError = ref('')
const filter = ref('')
const selectedId = ref<string | null>(null)
const preview = ref<DocumentRecord | null>(null)
const previewLoading = ref(false)

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return docs.value
  return docs.value.filter(d => d.title.toLowerCase().includes(q) || d.ref.toLowerCase().includes(q))
})

watch([open, () => props.source?._id], async ([isOpen]) => {
  if (!isOpen || !props.source) return
  docs.value = []
  filter.value = ''
  selectedId.value = null
  preview.value = null
  loadError.value = ''
  loading.value = true
  try {
    docs.value = await $fetch<DocSummary[]>(`/api/projects/${props.projectId}/sources/${props.source._id}/documents`)
  }
  catch (err) {
    loadError.value = errorMessage(err)
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

async function select(doc: DocSummary) {
  selectedId.value = doc._id
  previewLoading.value = true
  try {
    preview.value = await $fetch<DocumentRecord>(`/api/projects/${props.projectId}/documents/${doc._id}`)
  }
  catch (err) {
    useToast().error(errorMessage(err))
    selectedId.value = null
  }
  finally {
    previewLoading.value = false
  }
}

function back() {
  selectedId.value = null
  preview.value = null
}
</script>

<template>
  <UiModal v-model:open="open" :title="source?.title || 'Documents'" :description="docs.length ? `${formatNumber(docs.length)} document${docs.length === 1 ? '' : 's'} indexed` : undefined" width="1080px">
    <div class="docs" :class="{ 'has-preview': !!selectedId }">
      <div class="list-pane">
        <label class="search">
          <Search :size="14" class="dim" />
          <input v-model="filter" type="search" placeholder="Filter documents" aria-label="Filter documents">
        </label>
        <div v-if="loading" class="stack" style="--gap: 6px; padding: 8px">
          <div v-for="i in 6" :key="i" class="skeleton" style="height: 44px" />
        </div>
        <p v-else-if="loadError" class="danger-text small" style="padding: 12px">{{ loadError }}</p>
        <p v-else-if="!docs.length" class="muted small" style="padding: 12px">No documents yet. They appear after the first successful sync.</p>
        <ul v-else class="doc-list" role="listbox" aria-label="Documents">
          <li v-for="d in filtered" :key="d._id">
            <button type="button" class="doc-item" role="option" :aria-selected="selectedId === d._id" :class="{ active: selectedId === d._id }" @click="select(d)">
              <span class="truncate strong small">{{ d.title }}</span>
              <span class="truncate dim tiny mono">{{ d.ref }}</span>
              <span class="dim tiny">{{ d.chunkCount }} chunk{{ d.chunkCount === 1 ? '' : 's' }} · {{ formatBytes(d.size) }}</span>
            </button>
          </li>
          <li v-if="!filtered.length" class="muted small" style="padding: 12px">No match.</li>
        </ul>
      </div>

      <div class="preview-pane">
        <div v-if="previewLoading" class="center"><UiSpinner /></div>
        <template v-else-if="preview">
          <div class="preview-head">
            <button type="button" class="back" aria-label="Back to list" @click="back"><ArrowLeft :size="16" /></button>
            <div class="grow" style="min-width: 0">
              <h3 class="truncate">{{ preview.title }}</h3>
              <p class="dim tiny truncate">
                {{ preview.chunkCount }} chunks · updated {{ timeAgo(preview.updatedAt) }}
              </p>
            </div>
            <UiButton v-if="preview.url" :href="preview.url" target="_blank" rel="noopener" size="sm" variant="ghost">
              <ExternalLink :size="14" /> Open
            </UiButton>
          </div>
          <KnowledgeMarkdown class="preview-body" :source="preview.markdown" />
        </template>
        <div v-else class="center dim">
          <FileText :size="22" />
          <p class="small">Select a document to preview its extracted markdown</p>
        </div>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.docs { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px; height: min(70dvh, 720px); }
.list-pane, .preview-pane { min-height: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); display: flex; flex-direction: column; }
.search { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.search input { flex: 1; background: none; border: 0; outline: none; min-width: 0; }
.doc-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; }
.doc-item {
  width: 100%; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; text-align: left;
  background: none; border: 0; color: inherit;
}
.doc-item:hover { background: var(--surface-2); }
.doc-item.active { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
.preview-pane { overflow: hidden; }
.preview-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.preview-body { padding: 16px 20px; overflow-y: auto; flex: 1; font-size: 13.5px; }
.back { display: none; background: none; border: 0; color: var(--text-muted); padding: 4px; border-radius: 6px; }
.center { flex: 1; display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; text-align: center; padding: 24px; }
@media (max-width: 800px) {
  .docs { grid-template-columns: minmax(0, 1fr); }
  .docs .preview-pane { display: none; }
  .docs.has-preview .list-pane { display: none; }
  .docs.has-preview .preview-pane { display: flex; }
  .back { display: inline-grid; }
}
</style>
