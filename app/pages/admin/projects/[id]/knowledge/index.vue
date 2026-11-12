<script setup lang="ts">
import { FlaskConical, Library, Lock, MessageCircleQuestionMark, RefreshCw } from 'lucide-vue-next'

definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
const projectId = useProjectId()
const { can } = useMe()
const { projects } = useProjects()
const { run, pending: syncPending } = useAction()
const toast = useToast()

const project = computed(() => projects.value.find(p => p._id === projectId.value))
useHead({ title: () => `Knowledge · ${project.value?.title ?? 'Project'}` })

const tabs = computed(() => [
  { id: 'sources', label: 'Sources', icon: Library, count: project.value?.stats?.sources },
  { id: 'faq', label: 'FAQ', icon: MessageCircleQuestionMark, count: project.value?.stats?.faqs },
  { id: 'retrieval', label: 'Test retrieval', icon: FlaskConical, count: undefined }
] as const)
type TabId = 'sources' | 'faq' | 'retrieval'

const tab = computed<TabId>({
  get: () => (tabs.value.some(t => t.id === route.query.tab) ? route.query.tab as TabId : 'sources'),
  set: value => router.replace({ query: { ...route.query, tab: value === 'sources' ? undefined : value } })
})

const tabRefs = ref<HTMLElement[]>([])
function onTabKey(e: KeyboardEvent, index: number) {
  const n = tabs.value.length
  const next = e.key === 'ArrowRight' ? (index + 1) % n
    : e.key === 'ArrowLeft' ? (index - 1 + n) % n
      : e.key === 'Home' ? 0
        : e.key === 'End' ? n - 1
          : -1
  if (next < 0) return
  e.preventDefault()
  tab.value = tabs.value[next]!.id
  tabRefs.value[next]?.focus()
}

const sourcesPanel = ref<{ refresh: () => Promise<void> } | null>(null)

async function syncAll() {
  const res = await run(() => $fetch<{ queued: number }>(`/api/projects/${projectId.value}/sync`, { method: 'POST' }))
  if (!res) return
  if (res.queued) toast.success(`Queued ${res.queued} source${res.queued === 1 ? '' : 's'} for sync`)
  else toast.info(project.value?.stats?.sources ? 'All sources are already syncing' : 'Add a source first')
  if (tab.value !== 'sources') tab.value = 'sources'
  await nextTick()
  await sourcesPanel.value?.refresh()
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">{{ project?.title }}</p>
        <h1>Knowledge</h1>
        <p>Everything the assistant knows: websites, git repositories and curated FAQ — chunked, embedded and refreshed automatically.</p>
      </div>
      <UiButton v-if="projectId && can(projectId, 'sources:manage')" variant="secondary" :loading="syncPending" @click="syncAll">
        <RefreshCw :size="15" /> Sync all
      </UiButton>
    </header>

    <UiEmpty
      v-if="!projectId || !can(projectId, 'sources:manage')"
      :icon="Lock"
      title="No access"
      description="You need the Knowledge permission on this project to manage sources and FAQ."
    />

    <template v-else>
      <div class="tabs" role="tablist" aria-label="Knowledge sections">
        <button
          v-for="(t, i) in tabs"
          :id="`tab-${t.id}`"
          :key="t.id"
          ref="tabRefs"
          type="button"
          role="tab"
          class="tab"
          :class="{ active: tab === t.id }"
          :aria-selected="tab === t.id"
          :aria-controls="`panel-${t.id}`"
          :tabindex="tab === t.id ? 0 : -1"
          @click="tab = t.id"
          @keydown="onTabKey($event, i)"
        >
          <component :is="t.icon" :size="15" />
          {{ t.label }}
          <span v-if="t.count" class="count">{{ formatNumber(t.count) }}</span>
        </button>
      </div>

      <div :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`" class="panel-body">
        <KnowledgeSources v-if="tab === 'sources'" ref="sourcesPanel" :key="`s-${projectId}`" :project-id="projectId" />
        <KnowledgeFaq v-else-if="tab === 'faq'" :key="`f-${projectId}`" :project-id="projectId" />
        <KnowledgeRetrieval v-else :key="`r-${projectId}`" :project-id="projectId" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; box-shadow: inset 0 -1px 0 var(--border); margin-bottom: 20px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.tab {
  display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; background: none; border: 0;
  border-bottom: 2px solid transparent; color: var(--text-muted); font-weight: 500; white-space: nowrap;
  transition: color 0.15s var(--ease), border-color 0.15s var(--ease);
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--accent); }
.tab:focus-visible { border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
.count { font-size: 11.5px; padding: 1px 7px; border-radius: 99px; background: var(--surface-2); color: var(--text-dim); font-variant-numeric: tabular-nums; }
.tab.active .count { background: var(--accent-soft); color: var(--accent); }
</style>
