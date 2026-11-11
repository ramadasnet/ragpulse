<script setup lang="ts">
import { AlertTriangle, Bot, Code2, History, Sparkles } from 'lucide-vue-next'
import type { AppSettings, EmbeddingStatus } from '#shared/types'
import { SYNC_HISTORY_MAX_DAYS } from '#shared/types'

interface SettingsResponse {
  settings: AppSettings
  defaults: { userAgent: string }
  embedding: EmbeddingStatus
  vectorMode: 'atlas' | 'fallback' | 'unknown'
  projectCount: number
}

const { isAdmin } = useMe()
if (!isAdmin.value) await navigateTo('/admin', { replace: true })
useHead({ title: 'Settings · RAGPulse' })

const { confirm } = useConfirm()
const { data, error, refresh } = useFetch<SettingsResponse>('/api/system/settings', { lazy: true, server: false, immediate: isAdmin.value })

interface Form {
  embeddingModel: string
  /** Empty = the model's native size */
  embeddingDimensions: string
  summarize: boolean
  codeSummaryModel: string
  userAgent: string
  requestIntervalMs: number | string
  syncHistoryDays: number | string
}

function toForm(s: AppSettings): Form {
  return {
    embeddingModel: s.embeddingModel,
    embeddingDimensions: s.embeddingDimensionsParam ? String(s.embeddingDimensions) : '',
    summarize: !!s.codeSummaryModel,
    codeSummaryModel: s.codeSummaryModel || 'google/gemini-3.1-flash-lite',
    userAgent: s.userAgent,
    requestIntervalMs: s.requestIntervalMs,
    syncHistoryDays: s.syncHistoryDays
  }
}

const form = ref<Form | null>(null)
const original = ref('')
watch(() => data.value?.settings, (s) => {
  if (!s) return
  // Polling refreshes `data`: keep edits in progress
  if (form.value && JSON.stringify(form.value) !== original.value) return
  form.value = toForm(s)
  original.value = JSON.stringify(form.value)
}, { immediate: true })

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)

const embeddingChanged = computed(() => {
  const f = form.value
  const s = data.value?.settings
  if (!f || !s) return false
  const dims = f.embeddingDimensions.trim() ? Number(f.embeddingDimensions) : null
  const savedDims = s.embeddingDimensionsParam ? s.embeddingDimensions : null
  return f.embeddingModel.trim() !== s.embeddingModel || dims !== savedDims
})

const errors = computed(() => {
  const f = form.value
  const e: Partial<Record<keyof Form, string>> = {}
  if (!f) return e
  if (!f.embeddingModel.trim()) e.embeddingModel = 'Choose an embedding model'
  const dims = f.embeddingDimensions.trim()
  if (dims && (!/^\d+$/.test(dims) || Number(dims) < 32 || Number(dims) > 8192)) e.embeddingDimensions = 'A whole number between 32 and 8192, or empty'
  if (f.summarize && !f.codeSummaryModel.trim()) e.codeSummaryModel = 'Choose a model'
  if (f.userAgent && !/^[\x20-\x7E]*$/.test(f.userAgent)) e.userAgent = 'Only printable ASCII characters'
  const interval = Number(f.requestIntervalMs)
  if (!Number.isInteger(interval) || interval < 0 || interval > 60_000) e.requestIntervalMs = 'Between 0 and 60000 ms'
  const days = Number(f.syncHistoryDays)
  if (!Number.isInteger(days) || days < 1 || days > SYNC_HISTORY_MAX_DAYS) e.syncHistoryDays = `Between 1 and ${SYNC_HISTORY_MAX_DAYS} days`
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)

const embedding = computed(() => data.value?.embedding)
const reembedding = computed(() => !!embedding.value && embedding.value.current < embedding.value.total)
const progress = computed(() => (embedding.value?.total ? Math.floor((embedding.value.current / embedding.value.total) * 100) : 100))

let poll: ReturnType<typeof setInterval> | undefined
watch(reembedding, (busy) => {
  if (busy && !poll) poll = setInterval(() => refresh(), 4000)
  else if (!busy && poll) {
    clearInterval(poll)
    poll = undefined
  }
}, { immediate: true })
onBeforeUnmount(() => clearInterval(poll))

const { run, pending } = useAction()

async function save() {
  const f = form.value
  if (!f || !valid.value || !data.value) return
  if (embeddingChanged.value) {
    const projects = data.value.projectCount
    const ok = await confirm({
      title: 'Change the embedding model?',
      message: `All knowledge of ${projects === 1 ? 'the project' : `all ${formatNumber(projects)} projects`} (${formatNumber(data.value.embedding.total)} chunks) has to be re-indexed with “${f.embeddingModel.trim()}”. This runs in the background and is billed by OpenRouter. Until it finishes, answers only use the knowledge that has already been re-indexed.`,
      confirmLabel: 'Change model & re-index',
      danger: true
    })
    if (!ok) return
  }
  const saved = await run(() => $fetch<SettingsResponse>('/api/system/settings', {
    method: 'PATCH',
    body: {
      ...(embeddingChanged.value ? { embeddingModel: f.embeddingModel.trim(), embeddingDimensions: f.embeddingDimensions.trim() ? Number(f.embeddingDimensions) : null } : {}),
      codeSummaryModel: f.summarize ? f.codeSummaryModel.trim() : '',
      userAgent: f.userAgent.trim(),
      requestIntervalMs: Number(f.requestIntervalMs),
      syncHistoryDays: Number(f.syncHistoryDays)
    }
  }), embeddingChanged.value ? 'Settings saved — re-indexing started' : 'Settings saved')
  if (!saved) return
  form.value = toForm(saved.settings)
  original.value = JSON.stringify(form.value)
  data.value = saved
}

function discard() {
  if (data.value) form.value = toForm(data.value.settings)
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  return confirm({ title: 'Discard changes?', message: 'You have unsaved changes on this page.', confirmLabel: 'Discard', danger: true })
})
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <div class="page narrow">
    <header class="page-header">
      <div>
        <p class="eyebrow">Workspace</p>
        <h1>Settings</h1>
        <p>Embeddings, source code summaries, the website crawler and sync history, for all projects.</p>
      </div>
    </header>

    <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

    <div v-else-if="!form || !data" class="stack" style="--gap: 16px">
      <div v-for="i in 3" :key="i" class="panel panel-pad stack"><div class="skeleton" style="width: 30%; height: 16px" /><div class="skeleton" style="height: 38px" /></div>
    </div>

    <form v-else class="stack sections" style="--gap: 16px" novalidate @submit.prevent="save">
      <UiCard>
        <template #header>
          <div class="row" style="--gap: 8px"><Sparkles :size="16" class="dim" /><h2 class="card-title">Embeddings</h2></div>
        </template>
        <div class="stack" style="--gap: 16px">
          <p class="small muted">Turns knowledge and visitor questions into vectors for retrieval. Applies to every project.</p>

          <div v-if="reembedding" class="notice info" role="status" aria-live="polite">
            <div class="row between" style="--gap: 12px">
              <p class="small strong">Re-indexing knowledge with <span class="mono">{{ embedding?.model }}</span></p>
              <span class="small mono nowrap">{{ progress }}%</span>
            </div>
            <div class="bar" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${Math.max(2, progress)}%` }" /></div>
            <p class="tiny dim">{{ formatNumber(embedding?.current ?? 0) }} of {{ formatNumber(embedding?.total ?? 0) }} chunks done. Answers use the re-indexed knowledge only until this finishes.</p>
          </div>

          <AdminModelPicker v-model="form.embeddingModel" kind="embedding" label="Embedding model" hint="Any OpenRouter embedding model. Prices are USD per 1M tokens." />
          <p v-if="errors.embeddingModel" class="field-error">{{ errors.embeddingModel }}</p>
          <UiInput
            v-model="form.embeddingDimensions"
            label="Dimensions"
            optional
            inputmode="numeric"
            :placeholder="`Model default${form.embeddingModel === data.settings.embeddingModel && !data.settings.embeddingDimensionsParam ? ` (${data.settings.embeddingDimensions})` : ''}`"
            :error="errors.embeddingDimensions"
            hint="Shortens vectors on models that support it (e.g. OpenAI text-embedding-3). Leave empty for the model's native size."
          />

          <div v-if="embeddingChanged" class="notice warn" role="alert">
            <AlertTriangle :size="16" class="warn-icon" />
            <div class="stack" style="--gap: 4px">
              <p class="small strong">Changing the embedding model re-indexes all projects</p>
              <p class="tiny muted">
                Vectors from different models can't be compared, so the knowledge of {{ data.projectCount === 1 ? 'the project' : `all ${formatNumber(data.projectCount)} projects` }}
                ({{ formatNumber(data.embedding.total) }} chunks) is re-embedded in the background after you save. This is billed by OpenRouter,
                and until it finishes answers only use the knowledge that has already been re-indexed. The model is tested before it's applied.
              </p>
            </div>
          </div>
          <p v-else class="tiny dim">
            Current: <span class="mono">{{ data.settings.embeddingModel }}</span> · {{ data.settings.embeddingDimensions }} dimensions ·
            {{ data.vectorMode === 'atlas' ? 'Atlas Vector Search' : data.vectorMode === 'fallback' ? 'in-app similarity' : 'vector search unknown' }}
          </p>
        </div>
      </UiCard>

      <UiCard>
        <template #header>
          <div class="row" style="--gap: 8px"><Code2 :size="16" class="dim" /><h2 class="card-title">Source code summaries</h2></div>
        </template>
        <div class="stack" style="--gap: 16px">
          <UiToggle
            v-model="form.summarize"
            label="Summarize source code of git repositories"
            description="Each code file is summarized with the whole repository as context, and an overview of how the application works is written from all summaries. Helps the assistant answer technical questions. Summaries are cached: unchanged files are never sent twice."
          />
          <template v-if="form.summarize">
            <AdminModelPicker v-model="form.codeSummaryModel" label="Summary model" hint="A fast model with a large context window works best. Prices are USD per 1M input / output tokens." />
            <p v-if="errors.codeSummaryModel" class="field-error">{{ errors.codeSummaryModel }}</p>
          </template>
          <p v-else class="tiny dim">Code files are still indexed as plain code when a repository source includes them.</p>
        </div>
      </UiCard>

      <UiCard>
        <template #header>
          <div class="row" style="--gap: 8px"><Bot :size="16" class="dim" /><h2 class="card-title">Website crawler</h2></div>
        </template>
        <div class="stack" style="--gap: 16px">
          <UiInput
            v-model="form.userAgent"
            label="User-Agent"
            optional
            maxlength="300"
            autocomplete="off"
            :placeholder="data.defaults.userAgent"
            :error="errors.userAgent"
            hint="Sent with every request to websites. The first word is also used to match robots.txt rules. Leave empty for the default."
          />
          <UiInput
            v-model.number="form.requestIntervalMs"
            type="number"
            min="0"
            max="60000"
            step="100"
            label="Delay between requests (ms)"
            :error="errors.requestIntervalMs"
            hint="Minimum time between two requests to the same site. A longer robots.txt Crawl-delay wins. Sites that answer “429 Too Many Requests” are slowed down further and retried after their Retry-After time."
          />
        </div>
      </UiCard>

      <UiCard>
        <template #header>
          <div class="row" style="--gap: 8px"><History :size="16" class="dim" /><h2 class="card-title">Sync history</h2></div>
        </template>
        <div class="stack" style="--gap: 16px">
          <UiInput
            v-model.number="form.syncHistoryDays"
            type="number"
            :min="1"
            :max="SYNC_HISTORY_MAX_DAYS"
            label="Keep sync history (days)"
            :error="errors.syncHistoryDays"
            hint="Every source sync records the number of files, total size and duration, shown in each source's history. Older runs are deleted automatically."
          />
        </div>
      </UiCard>

      <Transition name="bar">
        <div v-if="dirty" class="savebar panel">
          <span class="dot warn" />
          <span class="grow small">Unsaved changes<template v-if="embeddingChanged"> · re-indexes all projects</template></span>
          <UiButton variant="ghost" size="sm" @click="discard">Discard</UiButton>
          <UiButton variant="primary" size="sm" type="submit" :loading="pending" :disabled="!valid">Save changes</UiButton>
        </div>
      </Transition>
    </form>
  </div>
</template>

<style scoped>
.sections { padding-bottom: 72px; }
.card-title { font-size: 15px; }
.notice {
  display: flex; gap: 10px; padding: 12px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-elev);
}
.notice.warn { border-color: rgb(251 191 36 / 0.35); background: var(--warning-soft); }
.notice.info { flex-direction: column; gap: 8px; }
.warn-icon { color: var(--warning); flex-shrink: 0; margin-top: 1px; }
.bar { height: 6px; border-radius: 6px; background: var(--surface-2); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--accent), var(--violet)); transition: width 0.4s var(--ease); }
.savebar {
  position: sticky; bottom: 16px; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px;
  background: rgb(19 22 28 / 0.92); backdrop-filter: blur(10px); box-shadow: var(--shadow-lg); border-color: var(--border-strong);
}
.bar-enter-active, .bar-leave-active { transition: opacity 0.18s var(--ease), transform 0.18s var(--ease); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(10px); }
</style>
