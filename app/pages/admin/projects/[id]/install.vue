<script setup lang="ts">
import {ExternalLink, Globe, Lock, Plus, X} from "lucide-vue-next"
import type {Project, ProjectPermission} from "#shared/types"

type ProjectWithPerms = Project & {permissions: ProjectPermission[]}

const projectId = useProjectId()
const allowed = await guardProjectPage(projectId.value!, "settings:edit")
const {refresh: refreshProjects} = useProjects()
const {run, pending: saving} = useAction()
useHead({title: "Install · RAGPulse"})

const {data: project, error} = useFetch<ProjectWithPerms>(() => `/api/projects/${projectId.value}`, {
    lazy: true,
    immediate: allowed,
    server: false
})

const baseUrl = computed(() => publicBaseUrl("chat"))
const chatUrl = computed(() => `${baseUrl.value}/chat/${projectId.value}`)
const scriptSnippet = computed(() => `<script src="${baseUrl.value}/embed.js" data-project="${projectId.value}" async><\/script>`)
const iframeSnippet = computed(
    () => `<iframe
  src="${chatUrl.value}"
  style="width:100%;height:600px;border:0"
  allow="clipboard-write"
  title="Chat"
></iframe>`
)
const apiSnippet = `<button onclick="RAGPulse.open()">Chat with us</button>
<!-- also: RAGPulse.close(), RAGPulse.toggle() -->`

const websiteHost = computed(() => {
    try {
        return project.value?.website ? new URL(project.value.website).host : ""
    } catch {
        return ""
    }
})

// ---------- Allowed domains ----------
const domains = ref<string[]>([])
const original = ref("")
const input = ref("")
const domainInput = ref<HTMLInputElement | null>(null)
const inputError = ref("")
watch(
    project,
    (p) => {
        if (!p) return
        domains.value = [...(p.allowedDomains || [])]
        original.value = JSON.stringify(domains.value)
    },
    {immediate: true}
)
const dirty = computed(() => JSON.stringify(domains.value) !== original.value)

const DOMAIN_RE = /^(https?:\/\/)?(\*\.)?(localhost|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)(:\d{1,5})?\/?$/

function addDomains() {
    inputError.value = ""
    const parts = input.value
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    const invalid: string[] = []
    for (const part of parts) {
        if (!DOMAIN_RE.test(part)) {
            invalid.push(part)
            continue
        }
        const value = part.replace(/\/$/, "")
        if (!domains.value.includes(value)) domains.value.push(value)
    }
    input.value = invalid.join(" ")
    if (invalid.length) inputError.value = `Not a valid domain: ${invalid.join(", ")}`
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
        e.preventDefault()
        addDomains()
    } else if (e.key === "Backspace" && !input.value && domains.value.length) {
        domains.value.pop()
    }
}

function remove(domain: string) {
    domains.value = domains.value.filter((d) => d !== domain)
}

async function save() {
    if (input.value.trim()) addDomains()
    if (inputError.value) return
    const updated = await run(() => $fetch<ProjectWithPerms>(`/api/projects/${projectId.value}`, {method: "PATCH", body: {allowedDomains: domains.value}}), "Allowed domains saved")
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
                <h1>Install</h1>
                <p>Add the chat to your website with one line of code, embed it inline, or share a direct link.</p>
            </div>
        </header>

        <UiEmpty v-if="error" title="Could not load project" :description="errorMessage(error)" />

        <div v-else-if="!project" class="stack" style="--gap: 16px">
            <div class="skeleton" style="height: 160px" />
            <div class="skeleton" style="height: 160px" />
        </div>

        <div v-else class="stack" style="--gap: 16px">
            <div v-if="!project.enabled" class="notice">
                This project is disabled: the chat and embeds return “not found” until you enable it in
                <NuxtLink :to="`/admin/projects/${project._id}/settings`">Settings</NuxtLink>.
            </div>

            <UiCard title="Chat widget" description="Recommended. Paste before the closing </body> tag on every page where the chat should appear.">
                <div class="stack">
                    <UiCopy :value="scriptSnippet" multiline />
                    <p class="muted small">
                        Optional attributes: <code>data-position="left"</code> to show the launcher on the left, <code>data-open="true"</code> to open the chat on page load. The script is tiny and loads the chat only when opened.
                    </p>
                    <details class="details">
                        <summary class="small">Open the chat from your own button</summary>
                        <UiCopy :value="apiSnippet" multiline />
                    </details>
                </div>
            </UiCard>

            <div class="grid-2">
                <UiCard title="Inline iframe" description="Embed the chat inside a page, e.g. a help center or contact page.">
                    <UiCopy :value="iframeSnippet" multiline />
                </UiCard>
                <UiCard title="Direct link" description="Share a full-page chat, e.g. from emails or your app menu.">
                    <div class="stack">
                        <UiCopy :value="chatUrl" />
                        <div>
                            <UiButton size="sm" :href="chatUrl" target="_blank" rel="noopener"><ExternalLink :size="14" /> Open chat</UiButton>
                        </div>
                    </div>
                </UiCard>
            </div>

            <UiCard title="Allowed domains" description="Only these sites can embed the chat. Other sites are blocked by the browser (CSP frame-ancestors) and by the API.">
                <div class="stack" style="--gap: 14px">
                    <div class="chips" @click="domainInput?.focus()">
                        <span v-if="websiteHost" class="chip locked" title="Your website domain is always allowed"> <Lock :size="12" /> {{ websiteHost }} </span>
                        <span v-for="d in domains" :key="d" class="chip">
                            <Globe :size="12" /> {{ d }}
                            <button type="button" class="chip-x" :aria-label="`Remove ${d}`" @click.stop="remove(d)"><X :size="12" /></button>
                        </span>
                        <input
                            ref="domainInput"
                            v-model="input"
                            class="chip-input"
                            placeholder="Add domain, e.g. app.example.com or *.example.com"
                            aria-label="Add allowed domain"
                            spellcheck="false"
                            autocapitalize="off"
                            @keydown="onKeydown"
                            @blur="input.trim() && addDomains()"
                        />
                    </div>
                    <p v-if="inputError" class="field-error">{{ inputError }}</p>
                    <ul class="help muted small">
                        <li>
                            Your website domain (<strong>{{ websiteHost || "not set" }}</strong
                            >, plus its www variant) is always allowed.
                        </li>
                        <li><code>*.example.com</code> allows example.com and all its subdomains.</li>
                        <li>Include a scheme or port to be specific, e.g. <code>https://app.example.com</code> or <code>localhost:5173</code>.</li>
                    </ul>
                    <div class="row end">
                        <UiButton variant="ghost" :disabled="!dirty || saving" @click="domains = JSON.parse(original)">Discard</UiButton>
                        <UiButton variant="primary" :loading="saving" :disabled="!dirty && !input.trim()" @click="save"><Plus v-if="input.trim()" :size="15" /> Save domains</UiButton>
                    </div>
                    <p class="dim tiny">Changes can take up to 30 seconds to apply to the embed.</p>
                </div>
            </UiCard>
        </div>
    </div>
</template>

<style scoped>
.notice {
    padding: 12px 16px;
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 13.5px;
}
.notice a {
    text-decoration: underline;
}
.details summary {
    cursor: pointer;
    color: var(--text-muted);
    margin-bottom: 10px;
    width: fit-content;
}
.details summary:hover {
    color: var(--text);
}
.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 8px;
    min-height: 48px;
    cursor: text;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    transition:
        border-color 0.15s var(--ease),
        box-shadow 0.15s var(--ease);
}
.chips:focus-within {
    border-color: var(--accent);
    box-shadow: var(--ring);
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 6px 0 10px;
    border-radius: 99px;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    font-size: 12.5px;
    font-family: var(--font-mono);
}
.chip.locked {
    padding-right: 10px;
    color: var(--text-muted);
    background: var(--accent-soft);
    border-color: transparent;
}
.chip-x {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--text-dim);
}
.chip-x:hover {
    background: var(--surface-3);
    color: var(--text);
}
.chip-input {
    flex: 1;
    min-width: 220px;
    border: 0;
    outline: none;
    background: transparent;
    padding: 4px 6px;
    font-size: 13.5px;
}
.chip-input:focus-visible {
    box-shadow: none;
}
.help {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
</style>
