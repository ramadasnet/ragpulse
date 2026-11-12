<script setup lang="ts">
import { AlertTriangle, Globe, ImageUp, RotateCcw, Trash2 } from 'lucide-vue-next'
import type { IngestDetail, Project, ProjectPermission } from '#shared/types'
import { INGEST_DETAIL_INFO, INGEST_DETAILS, projectIngestDetail, REFRESH_MAX_HOURS, REFRESH_MIN_HOURS } from '#shared/types'
import { defaultSystemInstructions } from '#shared/utils/instructions'

type ProjectWithPerms = Project & { permissions: ProjectPermission[] }

const projectId = useProjectId()
const allowed = await guardProjectPage(projectId.value!, 'settings:edit')
const { isAdmin } = useMe()
const { refresh: refreshProjects } = useProjects()
const { confirm } = useConfirm()
useHead({ title: 'Settings · RAGPulse' })

const { data: project, error } = useFetch<ProjectWithPerms>(() => `/api/projects/${projectId.value}`, {
  lazy: true,
  immediate: allowed,
  server: false
})

interface Form {
  title: string
  website: string
  enabled: boolean
  model: string
  temperature: number
  systemInstructions: string
  rateLimit: number
  supportEmail: string
  refreshIntervalHours: number
  ingestDetail: IngestDetail
}

function toForm(p: Project): Form {
  return {
    title: p.title,
    website: p.website,
    enabled: p.enabled,
    model: p.model,
    temperature: p.temperature,
    systemInstructions: p.systemInstructions,
    rateLimit: p.rateLimit,
    supportEmail: p.supportEmail || '',
    refreshIntervalHours: p.refreshIntervalHours,
    ingestDetail: projectIngestDetail(p)
  }
}

const form = ref<Form | null>(null)
const original = ref('')
const icon = ref<string | undefined>()
watch(project, (p) => {
  if (!p) return
  form.value = toForm(p)
  original.value = JSON.stringify(form.value)
  icon.value = p.icon
}, { immediate: true })

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)

const errors = computed(() => {
  const f = form.value
  const e: Partial<Record<keyof Form, string>> = {}
  if (!f) return e
  if (!f.title.trim()) e.title = 'Title is required'
  try {
    const u = new URL(f.website)
    if (!/^https?:$/.test(u.protocol)) e.website = 'Must be an http(s) URL'
  }
  catch {
    e.website = 'Enter a valid URL, e.g. https://example.com'
  }
  if (f.supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.supportEmail.trim())) e.supportEmail = 'Enter a valid email'
  if (!Number.isInteger(Number(f.rateLimit)) || f.rateLimit < 0 || f.rateLimit > 1000) e.rateLimit = 'Between 0 and 1000'
  if (!f.model.trim()) e.model = 'Choose a model'
  return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)

const refreshOptions = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168]
  .filter(h => h >= REFRESH_MIN_HOURS && h <= REFRESH_MAX_HOURS)
  .map(h => ({ value: h, label: h < 24 ? `Every ${h} hour${h === 1 ? '' : 's'}` : h === 24 ? 'Every day' : `Every ${h / 24} days` }))

const detailOptions = INGEST_DETAILS.map(id => ({ id, ...INGEST_DETAIL_INFO[id] }))
const detailChanged = computed(() => !!project.value && !!form.value && form.value.ingestDetail !== projectIngestDetail(project.value))

const temperatureLabel = computed(() => {
  const t = form.value?.temperature ?? 0
  if (t <= 0.3) return 'Precise'
  if (t <= 0.8) return 'Balanced'
  if (t <= 1.3) return 'Creative'
  return 'Wild'
})

const { run, pending } = useAction()

async function save() {
  const f = form.value
  if (!f || !valid.value) return
  const reindex = detailChanged.value
  const updated = await run(() => $fetch<ProjectWithPerms>(`/api/projects/${projectId.value}`, {
    method: 'PATCH',
    body: {
      title: f.title.trim(),
      website: f.website.trim(),
      enabled: f.enabled,
      model: f.model.trim(),
      temperature: Math.round(Number(f.temperature) * 100) / 100,
      systemInstructions: f.systemInstructions,
      rateLimit: Number(f.rateLimit),
      supportEmail: f.supportEmail.trim(),
      refreshIntervalHours: Number(f.refreshIntervalHours),
      ingestDetail: f.ingestDetail
    }
  }), reindex ? 'Settings saved, sources are being re-indexed' : 'Settings saved')
  if (!updated) return
  project.value = updated
  refreshProjects().catch(() => {})
}

function discard() {
  if (project.value) form.value = toForm(project.value)
}

function insertTemplate() {
  if (form.value) form.value.systemInstructions = defaultSystemInstructions(form.value.title, form.value.website)
}

// ----- Project icon -----
const fileInput = ref<HTMLInputElement | null>(null)
const iconUpload = useAction()
const iconFetch = useAction()

const MAX_ICON_FILE_BYTES = 5 * 1024 * 1024
const SMALL_ICON_BYTES = 200 * 1024
const ICON_PX = 128
// Mime types accepted by the server for the stored icon (see iconSchema)
const STORE_MIME = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i
const ICON_EXT_MIME: [RegExp, string][] = [
  [/\.ico$/i, 'image/x-icon'],
  [/\.svg$/i, 'image/svg+xml'],
  [/\.png$/i, 'image/png'],
  [/\.jpe?g$/i, 'image/jpeg'],
  [/\.webp$/i, 'image/webp'],
  [/\.gif$/i, 'image/gif'],
  [/\.avif$/i, 'image/avif']
]

/** Reads an image file as an icon data URI; unsupported or large images are downscaled to a 128px PNG. */
async function fileToIcon(file: File): Promise<string | null> {
  if (file.size > MAX_ICON_FILE_BYTES) return null
  const mime = (file.type.startsWith('image/') && file.type) || ICON_EXT_MIME.find(([re]) => re.test(file.name))?.[1]
  if (!mime) return null
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  // The reader may report a missing or wrong mime — the one derived above wins
  const dataUri = raw.replace(/^data:[^,]*,/, `data:${mime};base64,`)
  if (STORE_MIME.test(mime) && (file.size <= SMALL_ICON_BYTES || mime === 'image/svg+xml')) return dataUri
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ICON_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const scale = Math.max(ICON_PX / bitmap.width, ICON_PX / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h)
    bitmap.close()
    return canvas.toDataURL('image/png')
  }
  catch {
    return null
  }
}

function applyIcon(updated: ProjectWithPerms | undefined) {
  if (!updated) return
  // Kept in a separate ref: reassigning `project` would reset the (possibly dirty) form via its watcher
  icon.value = updated.icon
  refreshProjects().catch(() => {})
}

async function onIconFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  applyIcon(await iconUpload.run(async () => {
    const icon = await fileToIcon(file)
    if (!icon) throw new Error('Choose an image file of at most 5 MB')
    return $fetch<ProjectWithPerms>(`/api/projects/${projectId.value}`, { method: 'PATCH', body: { icon } })
  }, 'Icon updated'))
}

async function fetchFavicon() {
  applyIcon(await iconFetch.run(() => $fetch<ProjectWithPerms>(`/api/projects/${projectId.value}/icon`, { method: 'POST' }), 'Icon updated from the website'))
}

async function resetIcon() {
  applyIcon(await iconUpload.run(() => $fetch<ProjectWithPerms>(`/api/projects/${projectId.value}`, { method: 'PATCH', body: { icon: '' } }), 'Icon reset to the two-letter mark'))
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

// ----- Danger zone -----
const deleteOpen = ref(false)
const deleteConfirm = ref('')
const deleting = useAction()
async function deleteProject() {
  if (!project.value || deleteConfirm.value.trim() !== project.value.title.trim()) return
  const ok = await deleting.run(() => $fetch<{ ok: boolean }>(`/api/projects/${projectId.value}` as string, { method: 'DELETE' }), 'Project deleted')
  if (!ok) return
  deleteOpen.value = false
  original.value = JSON.stringify(form.value)
  await refreshProjects().catch(() => {})
  await navigateTo('/admin')
}
</script>

<template>
  <div class="page narrow">
    <header class="page-header">
      <div>
        <p class="eyebrow">Settings</p>
        <h1>Project settings</h1>
        <p>Configure the assistant's model, behaviour, limits and knowledge refresh.</p>
      </div>
    </header>

    <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

    <div v-else-if="!form" class="stack" style="--gap: 16px">
      <div v-for="i in 3" :key="i" class="panel panel-pad stack"><div class="skeleton" style="width: 30%; height: 16px" /><div class="skeleton" style="height: 38px" /><div class="skeleton" style="height: 38px" /></div>
    </div>

    <form v-else class="stack sections" style="--gap: 16px" novalidate @submit.prevent="save">
      <UiCard title="General">
        <div class="stack" style="--gap: 16px">
          <div class="grid-2">
            <UiInput v-model="form.title" label="Project name" maxlength="120" :error="errors.title" />
            <UiInput v-model="form.website" label="Website" inputmode="url" :error="errors.website" hint="This domain can always embed the chat." />
          </div>
          <UiField label="Icon" hint="Shown in the sidebar and project list. The website favicon is used by default.">
            <div class="icon-row">
              <ProjectMark :title="form.title" :icon="icon" class="icon-preview" />
              <UiButton size="sm" :loading="iconUpload.pending.value" @click="fileInput?.click()"><ImageUp :size="14" /> Upload image</UiButton>
              <UiButton size="sm" :loading="iconFetch.pending.value" @click="fetchFavicon"><Globe :size="14" /> Use website icon</UiButton>
              <UiButton v-if="icon" size="sm" variant="ghost" @click="resetIcon">Reset to letters</UiButton>
            </div>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="onIconFile">
          </UiField>
          <UiToggle v-model="form.enabled" label="Chat enabled" description="When paused, the widget shows an offline message and no AI calls are made." />
        </div>
      </UiCard>

      <UiCard title="AI" description="Model and behaviour of the assistant.">
        <div class="stack" style="--gap: 18px">
          <AdminModelPicker v-model="form.model" label="Model" hint="Prices are USD per 1M input / output tokens via OpenRouter." />
          <p v-if="errors.model" class="field-error">{{ errors.model }}</p>

          <UiField label="Temperature" :hint="`${temperatureLabel} — lower is more factual, higher is more varied. 0.2–0.4 works best for support.`">
            <template #aside><span class="mono small accent">{{ Number(form.temperature).toFixed(1) }}</span></template>
            <input v-model.number="form.temperature" type="range" min="0" max="2" step="0.1" class="range" aria-label="Temperature">
          </UiField>

          <UiTextarea v-model="form.systemInstructions" label="System instructions" :rows="14" mono maxlength="20000" hint="Combined with retrieved knowledge on every answer. Describe tone, scope and boundaries.">
            <template #aside>
              <button type="button" class="link-btn tiny" @click="insertTemplate"><RotateCcw :size="12" /> Use template</button>
            </template>
          </UiTextarea>
        </div>
      </UiCard>

      <UiCard title="Limits & support" description="Protect your budget and route hard questions to humans.">
        <div class="grid-2">
          <UiInput
            v-model.number="form.rateLimit"
            type="number"
            min="0"
            max="1000"
            label="Messages per conversation"
            :error="errors.rateLimit"
            hint="Visitor messages before the chat offers to contact support. 0 = unlimited."
          />
          <UiInput
            v-model="form.supportEmail"
            type="email"
            label="Support email"
            optional
            placeholder="support@example.com"
            :error="errors.supportEmail"
            hint="Receives unanswered questions. Leave empty to disable email escalation."
          />
        </div>
      </UiCard>

      <UiCard title="Knowledge" description="How much of your sources is indexed, and how often they are re-synced.">
        <div class="stack" style="--gap: 18px">
          <UiField label="Index detail" :hint="detailChanged ? 'Saving re-indexes every source of this project with the new preset.' : 'Applies to web pages, repositories, Drive files, PDFs and images. Larger indexes answer more precisely but need more database storage.'">
            <div class="detail-options" role="radiogroup" aria-label="Index detail">
              <label v-for="o in detailOptions" :key="o.id" class="detail-option" :class="{ on: form.ingestDetail === o.id }">
                <input v-model="form.ingestDetail" type="radio" name="ingestDetail" :value="o.id" class="sr-only">
                <span class="detail-head">
                  <span class="strong">{{ o.label }}</span>
                  <span v-if="o.id === 'balanced'" class="dim tiny">Default</span>
                </span>
                <span class="small muted">{{ o.description }}</span>
              </label>
            </div>
          </UiField>
          <div class="grid-2">
            <UiSelect v-model.number="form.refreshIntervalHours" label="Default refresh interval" :options="refreshOptions" />
            <p class="small muted explain">
              Applies to every source that doesn't set its own interval. Individual sources can override it on the
              <NuxtLink :to="`/admin/projects/${projectId}/knowledge`" class="accent">Knowledge</NuxtLink> page. Unchanged content is skipped, so frequent refreshes are cheap.
            </p>
          </div>
        </div>
      </UiCard>

      <UiCard v-if="isAdmin" class="danger-card">
        <template #header>
          <div class="row" style="--gap: 8px"><AlertTriangle :size="16" class="danger-text" /><h2 class="card-title">Danger zone</h2></div>
        </template>
        <div class="row between wrap" style="--gap: 16px">
          <div>
            <p class="strong">Delete this project</p>
            <p class="small muted">Permanently removes sources, FAQ, embeddings, conversations and questions. This cannot be undone.</p>
          </div>
          <UiButton variant="danger" @click="deleteOpen = true; deleteConfirm = ''"><Trash2 :size="14" /> Delete project</UiButton>
        </div>
      </UiCard>

      <Transition name="bar">
        <div v-if="dirty" class="savebar panel">
          <span class="dot warn" />
          <span class="grow small">Unsaved changes</span>
          <UiButton variant="ghost" size="sm" @click="discard">Discard</UiButton>
          <UiButton variant="primary" size="sm" type="submit" :loading="pending" :disabled="!valid">Save changes</UiButton>
        </div>
      </Transition>
    </form>

    <UiModal v-model:open="deleteOpen" title="Delete project" width="460px">
      <form class="stack" style="--gap: 14px" @submit.prevent="deleteProject">
        <p class="muted small">
          This permanently deletes <strong class="danger-text">{{ project?.title }}</strong> and all of its knowledge, conversations and questions.
        </p>
        <UiInput v-model="deleteConfirm" :label="`Type “${project?.title}” to confirm`" autocomplete="off" autofocus />
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="deleteOpen = false">Cancel</UiButton>
        <UiButton variant="danger" :loading="deleting.pending.value" :disabled="deleteConfirm.trim() !== project?.title.trim()" @click="deleteProject">Delete forever</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.sections { padding-bottom: 72px; }
.card-title { font-size: 15px; }
.icon-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.icon-preview {
  width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  font-weight: 700; flex-shrink: 0; background: linear-gradient(135deg, var(--accent), #5eead4); color: var(--accent-ink);
}
.link-btn { background: none; border: 0; color: var(--accent); padding: 0; display: inline-flex; align-items: center; gap: 4px; }
.explain { align-self: end; padding-bottom: 4px; }
.range { width: 100%; accent-color: var(--accent); height: 22px; cursor: pointer; }
.detail-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.detail-option {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; cursor: pointer;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius);
  transition: border-color 0.15s, background 0.15s;
}
.detail-option:hover { border-color: var(--border-strong); }
.detail-option.on { border-color: var(--accent); background: var(--accent-soft); }
.detail-option:focus-within { box-shadow: var(--ring); }
.detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
@media (max-width: 720px) { .detail-options { grid-template-columns: 1fr; } }
.danger-card { border-color: rgb(255 107 107 / 0.3); }
.savebar {
  position: sticky; bottom: 16px; z-index: 20; display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px;
  background: rgb(19 22 28 / 0.92); backdrop-filter: blur(10px); box-shadow: var(--shadow-lg); border-color: var(--border-strong);
}
.bar-enter-active, .bar-leave-active { transition: opacity 0.18s var(--ease), transform 0.18s var(--ease); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(10px); }
</style>
