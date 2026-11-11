<script setup lang="ts">
import {Moon, PanelLeft, PanelRight, RotateCcw, Sun} from "lucide-vue-next"
import type {ChatTheme, Project, ProjectPermission} from "#shared/types"

type ProjectWithPerms = Project & {permissions: ProjectPermission[]}

const projectId = useProjectId()
const allowed = await guardProjectPage(projectId.value!, "settings:edit")
const {refresh: refreshProjects} = useProjects()
const {run, pending: saving} = useAction()
useHead({title: "Appearance · RAGPulse"})

const {data: project, error} = useFetch<ProjectWithPerms>(() => `/api/projects/${projectId.value}`, {
    lazy: true,
    immediate: allowed,
    server: false
})

const form = ref<ChatTheme | null>(null)
const original = ref("")
watch(
    project,
    (p) => {
        if (!p) return
        form.value = resolveChatTheme({...p.theme, botName: p.theme?.botName || p.title})
        original.value = JSON.stringify(form.value)
    },
    {immediate: true}
)

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)

const colorFields = [
    {key: "accent", label: "Accent", hint: "User messages, send button, launcher"},
    {key: "accent2", label: "Secondary", hint: "Gradients and links"},
    {key: "highlight", label: "Highlight", hint: "Focus rings, source chips, badges"}
] as const

const errors = computed(() => {
    const f = form.value
    const e: Record<string, string> = {}
    if (!f) return e
    for (const c of colorFields) {
        if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(f[c.key])) e[c.key] = "Use a hex colour like #7c5cff"
    }
    if (!f.botName.trim()) e.botName = "Bot name is required"
    return e
})
const valid = computed(() => !Object.keys(errors.value).length)

function applyPreset(p: (typeof CHAT_THEME_PRESETS)[number]) {
    if (!form.value) return
    Object.assign(form.value, {accent: p.accent, accent2: p.accent2, highlight: p.highlight, mode: p.mode})
}

function isPresetActive(p: (typeof CHAT_THEME_PRESETS)[number]) {
    const f = form.value
    return !!f && f.accent.toLowerCase() === p.accent && f.accent2.toLowerCase() === p.accent2 && f.highlight.toLowerCase() === p.highlight
}

function reset() {
    if (original.value) form.value = JSON.parse(original.value)
}

// ---------- Live preview ----------
const frame = ref<HTMLIFrameElement | null>(null)
const chatBase = publicBaseUrl("chat")
const chatOrigin = urlOrigin(chatBase)
const previewSrc = computed(() => `${chatBase}/chat/${projectId.value}?preview=1`)

function postTheme() {
    if (!form.value || !frame.value?.contentWindow) return
    frame.value.contentWindow.postMessage({type: "ragpulse:theme", theme: {...form.value}, title: project.value?.title}, chatOrigin)
}
watch(form, postTheme, {deep: true})

function onMessage(e: MessageEvent) {
    if (e.origin === chatOrigin && e.source === frame.value?.contentWindow && e.data?.type === "ragpulse:ready") postTheme()
}
onMounted(() => window.addEventListener("message", onMessage))
onBeforeUnmount(() => window.removeEventListener("message", onMessage))

const launcherInk = computed(() => chatInkOn(form.value?.accent || "#000000"))

async function save() {
    if (!form.value || !valid.value) return
    const theme = {...form.value, botName: form.value.botName.trim()}
    const updated = await run(() => $fetch<ProjectWithPerms>(`/api/projects/${projectId.value}`, {method: "PATCH", body: {theme}}), "Appearance saved")
    if (updated) {
        project.value = updated
        refreshProjects().catch(() => {})
    }
}
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">{{ project?.title || "Project" }}</p>
                <h1>Appearance</h1>
                <p>Make the chat feel like part of your product. Changes preview live, visitors see them after saving.</p>
            </div>
            <div class="row">
                <UiButton variant="ghost" :disabled="!dirty || saving" @click="reset"><RotateCcw :size="15" /> Reset</UiButton>
                <UiButton variant="primary" :loading="saving" :disabled="!dirty || !valid" @click="save">Save changes</UiButton>
            </div>
        </header>

        <UiEmpty v-if="error" title="Could not load project" :description="errorMessage(error)" />

        <div v-else-if="!form" class="layout">
            <div class="stack">
                <div class="skeleton" style="height: 220px" />
                <div class="skeleton" style="height: 280px" />
            </div>
            <div class="skeleton" style="height: 640px; border-radius: 20px" />
        </div>

        <div v-else class="layout">
            <div class="stack" style="--gap: 16px">
                <UiCard title="Colours" description="Pick a preset or fine-tune each colour.">
                    <div class="stack" style="--gap: 18px">
                        <div class="presets" role="list">
                            <button v-for="p in CHAT_THEME_PRESETS" :key="p.name" type="button" role="listitem" class="preset" :class="{active: isPresetActive(p)}" :aria-pressed="isPresetActive(p)" @click="applyPreset(p)">
                                <span class="swatches"> <i :style="{background: p.accent}" /><i :style="{background: p.accent2}" /><i :style="{background: p.highlight}" /> </span>
                                <span class="small">{{ p.name }}</span>
                            </button>
                        </div>

                        <div class="field">
                            <span class="field-label">Mode</span>
                            <div class="segmented" role="radiogroup" aria-label="Colour mode">
                                <button type="button" role="radio" :aria-checked="form.mode === 'light'" :class="{on: form.mode === 'light'}" @click="form.mode = 'light'"><Sun :size="15" /> Light</button>
                                <button type="button" role="radio" :aria-checked="form.mode === 'dark'" :class="{on: form.mode === 'dark'}" @click="form.mode = 'dark'"><Moon :size="15" /> Dark</button>
                            </div>
                        </div>

                        <div class="colors">
                            <UiField v-for="c in colorFields" :key="c.key" :label="c.label" :hint="c.hint" :error="errors[c.key]">
                                <div class="color-row">
                                    <input v-model="form[c.key]" type="color" class="control" :aria-label="`${c.label} colour picker`" />
                                    <input v-model.trim="form[c.key]" class="control mono" maxlength="7" spellcheck="false" :aria-label="`${c.label} hex value`" :class="{invalid: !!errors[c.key]}" />
                                </div>
                            </UiField>
                        </div>
                    </div>
                </UiCard>

                <UiCard title="Content" description="What visitors see in the chat window.">
                    <div class="stack" style="--gap: 14px">
                        <UiInput v-model="form.botName" label="Bot name" maxlength="60" :error="errors.botName" />
                        <UiTextarea v-model="form.welcomeMessage" label="Welcome message" :rows="3" maxlength="1000" hint="Shown as the first message. Markdown supported." />
                        <UiInput v-model="form.placeholder" label="Input placeholder" maxlength="120" />
                        <div class="field">
                            <span class="field-label">Launcher position</span>
                            <div class="segmented" role="radiogroup" aria-label="Launcher position">
                                <button type="button" role="radio" :aria-checked="form.position === 'left'" :class="{on: form.position === 'left'}" @click="form.position = 'left'"><PanelLeft :size="15" /> Bottom left</button>
                                <button type="button" role="radio" :aria-checked="form.position === 'right'" :class="{on: form.position === 'right'}" @click="form.position = 'right'"><PanelRight :size="15" /> Bottom right</button>
                            </div>
                            <p class="field-hint">Applies to the JavaScript embed. Can be overridden per page with <code>data-position</code>.</p>
                        </div>
                    </div>
                </UiCard>
            </div>

            <aside class="preview-col">
                <div class="preview-head">
                    <p class="section-title" style="margin: 0">Live preview</p>
                    <UiBadge v-if="dirty" tone="warning">Unsaved</UiBadge>
                </div>
                <div class="device">
                    <iframe ref="frame" :src="previewSrc" title="Chat preview" class="preview-frame" @load="postTheme" />
                </div>
                <div class="launcher-row" :class="form.position">
                    <span class="launcher" :style="{background: `linear-gradient(135deg, ${form.accent}, ${form.accent2})`, color: launcherInk}" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
                        </svg>
                    </span>
                    <span class="dim tiny">Launcher</span>
                </div>
            </aside>
        </div>
    </div>
</template>

<style scoped>
.layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    gap: 24px;
    align-items: start;
}
@media (max-width: 1080px) {
    .layout {
        grid-template-columns: minmax(0, 1fr);
    }
}

.presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
}
.preset {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border-radius: var(--radius);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--text-muted);
    text-align: left;
    transition:
        border-color 0.15s var(--ease),
        color 0.15s;
}
.preset:hover {
    border-color: var(--border-strong);
    color: var(--text);
}
.preset.active {
    border-color: var(--accent);
    color: var(--text);
    box-shadow: var(--ring);
}
.swatches {
    display: flex;
}
.swatches i {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--bg-elev);
}
.swatches i + i {
    margin-left: -6px;
}

.segmented {
    display: inline-flex;
    padding: 3px;
    gap: 3px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: fit-content;
}
.segmented button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    transition:
        background 0.15s,
        color 0.15s;
}
.segmented button:hover {
    color: var(--text);
}
.segmented button.on {
    background: var(--surface-3);
    color: var(--text);
}

.colors {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
}
@media (max-width: 720px) {
    .colors {
        grid-template-columns: minmax(0, 1fr);
    }
}
.color-row {
    display: flex;
    gap: 8px;
}
.color-row .mono {
    font-family: var(--font-mono);
    font-size: 13px;
    text-transform: lowercase;
}

.preview-col {
    position: sticky;
    top: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 22px;
}
.device {
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    height: 640px;
    max-height: calc(100vh - 140px);
    min-height: 480px;
    background: var(--surface);
}
.preview-frame {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
}
.launcher-row {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-start;
    flex-direction: row-reverse;
}
.launcher-row.left {
    flex-direction: row;
}
.launcher {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: 0 10px 28px -8px rgb(0 0 0 / 0.6);
}
@media (max-width: 1080px) {
    .preview-col {
        position: static;
    }
}
</style>
