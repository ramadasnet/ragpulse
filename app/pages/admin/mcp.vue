<script setup lang="ts">
import {Bot, KeyRound, Plus, Trash2, TriangleAlert, Wrench} from "lucide-vue-next"
import type {ProjectPermission} from "#shared/types"
import {PERMISSION_INFO, PROJECT_PERMISSIONS} from "#shared/types"

useHead({title: "MCP & API · RAGPulse"})

interface TokenRow {
    _id: string
    name: string
    prefix: string
    projectIds?: string[]
    permissions?: ProjectPermission[]
    expiresAt?: string
    lastUsedAt?: string
    createdAt: string
}

interface CreatedToken extends TokenRow {
    token: string
}

const toast = useToast()
const {confirm} = useConfirm()
const {run, pending: creating} = useAction()
const {projects, ensure: ensureProjects} = useProjects()

const endpoint = computed(() => `${publicBaseUrl("admin")}/mcp`)

const {data: tokens, pending: loading, refresh, error: loadError} = await useFetch<TokenRow[]>("/api/tokens", {default: () => []})
onMounted(() => ensureProjects())

const createOpen = ref(false)
const newName = ref("")
const expiresInDays = ref<number>(0)
const restrictProjects = ref(false)
const selectedProjectIds = ref<string[]>([])
const restrictPermissions = ref(false)
const selectedPermissions = ref<ProjectPermission[]>([...PROJECT_PERMISSIONS])
const nameError = ref("")
const scopeError = ref("")
const created = ref<CreatedToken | null>(null)
const revoking = ref<string | null>(null)

const expiryOptions = [
    {value: 0, label: "Never expires"},
    {value: 7, label: "7 days"},
    {value: 30, label: "30 days"},
    {value: 90, label: "90 days"},
    {value: 365, label: "1 year"}
]

const projectTitleById = computed(() => new Map(projects.value.map((p) => [p._id, p.title])))

function isExpired(expiresAt?: string): boolean {
    return !!expiresAt && new Date(expiresAt).getTime() <= Date.now()
}

function projectScopeTitle(ids?: string[]): string {
    if (!ids?.length) return ""
    return ids.map((id) => projectTitleById.value.get(id) || id).join(", ")
}

async function openCreate() {
    newName.value = ""
    expiresInDays.value = 0
    restrictProjects.value = false
    selectedProjectIds.value = []
    restrictPermissions.value = false
    selectedPermissions.value = [...PROJECT_PERMISSIONS]
    nameError.value = ""
    scopeError.value = ""
    created.value = null
    createOpen.value = true
    await ensureProjects()
}

async function createToken() {
    const name = newName.value.trim()
    if (!name) {
        nameError.value = "Give the token a name, e.g. the bot that will use it."
        return
    }
    nameError.value = ""
    if (restrictProjects.value && !selectedProjectIds.value.length) {
        scopeError.value = "Select at least one project, or turn off project restriction."
        return
    }
    scopeError.value = ""
    const body: Record<string, unknown> = {name}
    if (expiresInDays.value > 0) body.expiresInDays = expiresInDays.value
    if (restrictProjects.value) body.projectIds = selectedProjectIds.value
    if (restrictPermissions.value) body.permissions = selectedPermissions.value
    const result = await run(() => $fetch<CreatedToken>("/api/tokens", {method: "POST", body}))
    if (!result) return
    created.value = result
    await refresh()
}

watch(createOpen, (open) => {
    // Never keep the plain token around once the dialog is closed
    if (!open) created.value = null
})

async function revoke(token: TokenRow) {
    const yes = await confirm({
        title: "Revoke token?",
        message: `"${token.name}" (${token.prefix}…) stops working immediately. Clients using it will get 401 errors.`,
        confirmLabel: "Revoke",
        danger: true
    })
    if (!yes) return
    revoking.value = token._id
    try {
        await $fetch(`/api/tokens/${token._id}`, {method: "DELETE"})
        toast.success("Token revoked")
        await refresh()
    } catch (err) {
        toast.error(errorMessage(err))
    } finally {
        revoking.value = null
    }
}

type SnippetKey = "json" | "claude" | "remote" | "curl"
const snippetTabs: Array<{key: SnippetKey; label: string; hint: string}> = [
    {key: "json", label: "MCP config", hint: "For clients with remote (HTTP) MCP support: Claude, Cursor, VS Code, Grok, Duet, Muse and most agent frameworks."},
    {key: "claude", label: "Claude Code", hint: "Adds the server to Claude Code from your terminal."},
    {key: "remote", label: "stdio (mcp-remote)", hint: "For clients that only support local stdio servers. Requires Node.js."},
    {key: "curl", label: "curl", hint: "Quick connectivity test: lists the available tools."}
]

function snippet(key: SnippetKey, token: string): string {
    const url = endpoint.value
    switch (key) {
        case "json":
            return JSON.stringify({mcpServers: {ragpulse: {type: "http", url, headers: {Authorization: `Bearer ${token}`}}}}, null, 2)
        case "claude":
            return `claude mcp add --transport http ragpulse ${url} \\\n  --header "Authorization: Bearer ${token}"`
        case "remote":
            return JSON.stringify(
                {
                    mcpServers: {
                        ragpulse: {
                            command: "npx",
                            args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
                            env: {AUTH_HEADER: `Bearer ${token}`}
                        }
                    }
                },
                null,
                2
            )
        case "curl":
            return `curl -X POST ${url} \\\n  -H 'Authorization: Bearer ${token}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Accept: application/json, text/event-stream' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
    }
}

const pageTab = ref<SnippetKey>("json")
const modalTab = ref<SnippetKey>("json")

function onTabKeydown(e: KeyboardEvent, current: SnippetKey, set: (key: SnippetKey) => void) {
    const idx = snippetTabs.findIndex((t) => t.key === current)
    let next = -1
    if (e.key === "ArrowRight") next = (idx + 1) % snippetTabs.length
    else if (e.key === "ArrowLeft") next = (idx - 1 + snippetTabs.length) % snippetTabs.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = snippetTabs.length - 1
    if (next === -1) return
    e.preventDefault()
    set(snippetTabs[next]!.key)
    const list = e.currentTarget as HTMLElement | null
    const buttons = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    const btn = buttons?.[next]
    btn?.focus()
    btn?.scrollIntoView({block: "nearest", inline: "nearest"})
}

function selectTab(e: MouseEvent, set: (key: SnippetKey) => void, key: SnippetKey) {
    set(key)
    ;(e.currentTarget as HTMLElement | null)?.scrollIntoView({block: "nearest", inline: "nearest"})
}

const tools: Array<{name: string; description: string; permission?: ProjectPermission}> = [
    {name: "list_projects", description: "Projects you can access, with open question counts and your permissions."},
    {name: "get_project", description: "Project details, knowledge source summary and FAQ count."},
    {name: "get_project_stats", description: "Sessions, messages, latency, token cost, top cited sources and escalations over the last N days.", permission: "analytics:read"},
    {name: "list_unanswered_questions", description: "Escalated visitor questions with conversation context and human-handling state.", permission: "questions:reply"},
    {name: "reply_to_question", description: "Answer an open question: posted into the visitor's chat, emailed when away, and optionally added to the FAQ.", permission: "questions:reply"},
    {name: "dismiss_question", description: "Dismiss spam or duplicates, or reopen a dismissed question.", permission: "questions:reply"},
    {name: "list_sessions", description: "Recent chat sessions of a project, with visitor search and cursor pagination.", permission: "sessions:read"},
    {name: "get_session", description: "A full conversation with its messages and related questions.", permission: "sessions:read"},
    {name: "send_session_message", description: "Post a proactive follow-up message into a visitor's chat.", permission: "questions:reply"},
    {name: "finish_session", description: "Mark a session finished (or reopen it) and learn a sanitized FAQ from human replies.", permission: "questions:reply"},
    {name: "search_knowledge", description: "Semantic search over the project knowledge base using the chat retrieval index."},
    {name: "get_document", description: "Read the indexed Markdown of a page, repository file or Drive file, in slices (offset / max_chars)."},
    {name: "list_faqs", description: "FAQ entries of a project, optionally filtered by text."},
    {name: "add_faq", description: "Add a question/answer pair to the FAQ and index it.", permission: "sources:manage"},
    {name: "update_faq", description: "Update an existing FAQ entry and re-index it.", permission: "sources:manage"},
    {name: "delete_faq", description: "Delete a FAQ entry and remove it from the vector index.", permission: "sources:manage"},
    {name: "list_sources", description: "Knowledge sources (websites, git repos, Google Drive folders) with sync status.", permission: "sources:manage"},
    {name: "trigger_sync", description: "Queue an immediate re-sync of one or all sources.", permission: "sources:manage"}
]
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <div class="eyebrow">Integrations</div>
                <h1>MCP &amp; API</h1>
                <p>Connect your own bots and agents - Grok, Duet, Muse, Claude or any MCP client - so they can triage escalated questions, research the knowledge base and reply to visitors on your behalf.</p>
            </div>
            <UiButton variant="primary" @click="openCreate"> <Plus :size="16" aria-hidden="true" /> Create token </UiButton>
        </header>

        <div class="stack" style="--gap: 20px">
            <UiCard pad title="Endpoint" description="One endpoint for all projects. Each request is authenticated with an API token.">
                <div class="stack" style="--gap: 16px">
                    <UiField label="Server URL">
                        <UiCopy :value="endpoint" />
                    </UiField>
                    <dl class="facts">
                        <div>
                            <dt>Transport</dt>
                            <dd>Streamable HTTP <span class="dim">(stateless, JSON responses)</span></dd>
                        </div>
                        <div>
                            <dt>Authentication</dt>
                            <dd><code>Authorization: Bearer rp_…</code></dd>
                        </div>
                        <div>
                            <dt>Permissions</dt>
                            <dd>Scoped to the creator's access, optionally narrowed per token.</dd>
                        </div>
                    </dl>
                </div>
            </UiCard>

            <UiCard title="API tokens" description="Your personal tokens. Create one per bot or agent, optionally scoped to specific projects, permissions and an expiration date." :pad="false">
                <template #actions>
                    <UiButton size="sm" @click="openCreate"> <Plus :size="14" aria-hidden="true" /> New </UiButton>
                </template>

                <div v-if="loading && !tokens?.length" class="stack token-skeleton" style="--gap: 10px">
                    <div v-for="i in 3" :key="i" class="skeleton" style="height: 18px" />
                </div>
                <div v-else-if="loadError" class="card-pad danger-text small">{{ errorMessage(loadError) }}</div>
                <div v-else-if="!tokens?.length" class="card-pad">
                    <UiEmpty :icon="KeyRound" title="No tokens yet" description="Create a token, then paste the generated config into your MCP client.">
                        <UiButton variant="primary" size="sm" @click="openCreate"> <Plus :size="14" aria-hidden="true" /> Create token </UiButton>
                    </UiEmpty>
                </div>
                <div v-else class="table-scroll">
                    <table class="table">
                        <thead>
                            <tr>
                                <th scope="col">Name</th>
                                <th scope="col">Token</th>
                                <th scope="col">Scope</th>
                                <th scope="col">Last used</th>
                                <th scope="col">Created</th>
                                <th scope="col"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="t in tokens" :key="t._id">
                                <td>
                                    <div class="strong">{{ t.name }}</div>
                                    <div v-if="t.expiresAt" class="tiny" :class="isExpired(t.expiresAt) ? 'danger-text' : 'dim'">
                                        {{ isExpired(t.expiresAt) ? `Expired ${formatDate(t.expiresAt)}` : `Expires ${formatDate(t.expiresAt)}` }}
                                    </div>
                                </td>
                                <td>
                                    <code class="muted">{{ t.prefix }}…</code>
                                </td>
                                <td>
                                    <span v-if="!t.projectIds && !t.permissions" class="dim small">Full access</span>
                                    <div v-else class="row wrap" style="--gap: 6px">
                                        <UiBadge v-if="t.projectIds" tone="neutral" :title="projectScopeTitle(t.projectIds)"> {{ t.projectIds.length }} {{ t.projectIds.length === 1 ? "project" : "projects" }} </UiBadge>
                                        <UiBadge v-if="t.permissions" :tone="t.permissions.length ? 'accent' : 'neutral'" :title="t.permissions.join(', ') || 'Read-only knowledge access'">
                                            {{ t.permissions.length ? `${t.permissions.length} ${t.permissions.length === 1 ? "perm" : "perms"}` : "read-only" }}
                                        </UiBadge>
                                    </div>
                                </td>
                                <td>
                                    <span v-if="t.lastUsedAt" class="row" style="--gap: 8px"><span class="dot ok" />{{ timeAgo(t.lastUsedAt) }}</span>
                                    <span v-else class="dim">Never</span>
                                </td>
                                <td class="muted" :title="formatDate(t.createdAt, true)">{{ formatDate(t.createdAt) }}</td>
                                <td class="actions">
                                    <UiButton size="sm" variant="ghost" :loading="revoking === t._id" :aria-label="`Revoke token ${t.name}`" @click="revoke(t)"> <Trash2 :size="14" aria-hidden="true" /> Revoke </UiButton>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </UiCard>

            <UiCard pad title="Connect a client" description="Replace &lt;YOUR_TOKEN&gt; with a token. Creating a token shows these snippets pre-filled.">
                <div class="stack" style="--gap: 12px">
                    <div class="tabs" role="tablist" aria-label="Client configuration" @keydown="onTabKeydown($event, pageTab, (k) => (pageTab = k))">
                        <button
                            v-for="tab in snippetTabs"
                            :id="`page-tab-${tab.key}`"
                            :key="tab.key"
                            type="button"
                            role="tab"
                            class="tab"
                            :aria-selected="pageTab === tab.key"
                            :tabindex="pageTab === tab.key ? 0 : -1"
                            @click="selectTab($event, (k) => (pageTab = k), tab.key)"
                        >
                            {{ tab.label }}
                        </button>
                    </div>
                    <div role="tabpanel" :aria-labelledby="`page-tab-${pageTab}`" class="stack" style="--gap: 10px">
                        <p class="muted small">{{ snippetTabs.find((t) => t.key === pageTab)?.hint }}</p>
                        <UiCopy :value="snippet(pageTab, '<YOUR_TOKEN>')" multiline />
                    </div>
                </div>
            </UiCard>

            <UiCard title="Tools" description="What connected agents can do. Each tool checks the token's effective permission on the project." :pad="false">
                <template #actions>
                    <UiBadge tone="violet"><Wrench :size="12" aria-hidden="true" /> {{ tools.length }} tools</UiBadge>
                </template>
                <ul class="tools divider-list" role="list">
                    <li v-for="tool in tools" :key="tool.name" class="tool">
                        <div class="grow">
                            <code class="tool-name">{{ tool.name }}</code>
                            <p class="muted small">{{ tool.description }}</p>
                        </div>
                        <UiBadge v-if="tool.permission" tone="accent" :title="PERMISSION_INFO[tool.permission].description">
                            {{ tool.permission }}
                        </UiBadge>
                        <UiBadge v-else tone="neutral">any access</UiBadge>
                    </li>
                </ul>
                <template #footer>
                    <div class="row grow small muted" style="--gap: 8px">
                        <Bot :size="15" aria-hidden="true" />
                        <span>Prompt <code>answer_unanswered_questions</code> walks an agent through the escalated questions triage workflow.</span>
                    </div>
                </template>
            </UiCard>
        </div>

        <UiModal
            v-model:open="createOpen"
            :title="created ? 'Token created' : 'Create API token'"
            :description="created ? undefined : 'Name the token after the bot or agent that will use it, and optionally narrow its scope.'"
            :width="created ? '680px' : '520px'"
        >
            <form v-if="!created" id="create-token" class="stack" style="--gap: 16px" @submit.prevent="createToken">
                <UiInput v-model="newName" label="Name" placeholder="e.g. Support triage bot" maxlength="80" :error="nameError" autofocus />
                <UiSelect v-model.number="expiresInDays" label="Expiration" :options="expiryOptions" />

                <UiToggle v-model="restrictProjects" label="Limit to specific projects" description="When off, the token can access every project you have access to." />
                <fieldset v-if="restrictProjects" class="scope-box">
                    <legend class="scope-legend">Allowed projects</legend>
                    <p v-if="!projects.length" class="small dim">No projects available.</p>
                    <div v-else class="scope-grid">
                        <label v-for="p in projects" :key="p._id" class="scope-check">
                            <input v-model="selectedProjectIds" type="checkbox" :value="p._id" />
                            <span>{{ p.title }}</span>
                        </label>
                    </div>
                    <p v-if="scopeError" class="field-error">{{ scopeError }}</p>
                </fieldset>

                <UiToggle v-model="restrictPermissions" label="Limit permissions" description="Restrict which actions this token can perform (uncheck all for read-only knowledge search)." />
                <fieldset v-if="restrictPermissions" class="scope-box">
                    <legend class="scope-legend">Allowed permissions</legend>
                    <div class="stack" style="--gap: 8px">
                        <label v-for="perm in PROJECT_PERMISSIONS" :key="perm" class="scope-check">
                            <input v-model="selectedPermissions" type="checkbox" :value="perm" />
                            <span>
                                <strong>{{ PERMISSION_INFO[perm].label }}</strong>
                                <span class="dim small"> ({{ perm }}) - {{ PERMISSION_INFO[perm].description }}</span>
                            </span>
                        </label>
                    </div>
                </fieldset>
            </form>

            <div v-else class="stack fade-in" style="--gap: 16px">
                <div class="warning" role="alert">
                    <TriangleAlert :size="16" aria-hidden="true" />
                    <span>Copy this token now - it will not be shown again. Store it like a password.</span>
                </div>
                <UiField :label="created.name">
                    <UiCopy :value="created.token" />
                </UiField>
                <div class="stack" style="--gap: 10px">
                    <h3 class="section-title">Ready-to-paste config</h3>
                    <div class="tabs" role="tablist" aria-label="Client configuration for the new token" @keydown="onTabKeydown($event, modalTab, (k) => (modalTab = k))">
                        <button
                            v-for="tab in snippetTabs"
                            :id="`modal-tab-${tab.key}`"
                            :key="tab.key"
                            type="button"
                            role="tab"
                            class="tab"
                            :aria-selected="modalTab === tab.key"
                            :tabindex="modalTab === tab.key ? 0 : -1"
                            @click="selectTab($event, (k) => (modalTab = k), tab.key)"
                        >
                            {{ tab.label }}
                        </button>
                    </div>
                    <div role="tabpanel" :aria-labelledby="`modal-tab-${modalTab}`" class="stack" style="--gap: 10px">
                        <p class="muted small">{{ snippetTabs.find((t) => t.key === modalTab)?.hint }}</p>
                        <UiCopy :value="snippet(modalTab, created.token)" multiline />
                    </div>
                </div>
            </div>

            <template #footer>
                <template v-if="!created">
                    <UiButton variant="ghost" @click="createOpen = false">Cancel</UiButton>
                    <UiButton variant="primary" type="submit" form="create-token" :loading="creating">Create token</UiButton>
                </template>
                <UiButton v-else variant="primary" @click="createOpen = false">Done</UiButton>
            </template>
        </UiModal>
    </div>
</template>

<style scoped>
.facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin: 0;
}
.facts dt {
    font-size: 12px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
}
.facts dd {
    margin: 0;
}
.facts code {
    color: var(--accent);
}
@media (max-width: 720px) {
    .facts {
        grid-template-columns: minmax(0, 1fr);
    }
}

.card-pad {
    padding: 20px;
}
.token-skeleton {
    padding: 20px;
}
.table-scroll {
    overflow-x: auto;
}
.table-scroll .table th {
    background: transparent;
}

.tabs {
    display: flex;
    gap: 4px;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 3px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: fit-content;
    max-width: 100%;
}
.tabs::-webkit-scrollbar {
    display: none;
}
.tab {
    position: relative;
    flex: none;
    min-block-size: 30px;
    background: none;
    border: 0;
    color: var(--text-muted);
    padding: 5px 12px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 500;
    transition:
        background 0.15s var(--ease),
        color 0.15s var(--ease);
}
.tab:hover {
    color: var(--text);
}
.tab[aria-selected="true"] {
    background: var(--surface-3);
    color: var(--text);
}
.tab[aria-selected="true"]::after {
    content: "";
    position: absolute;
    inset: auto 8px 0;
    border-block-end: 2px solid var(--accent);
}

.scope-box {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
}
.scope-legend {
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
}
.scope-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
}
.scope-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    min-block-size: 24px;
    cursor: pointer;
}
.scope-check input {
    margin-top: 3px;
    accent-color: var(--accent);
}

.tools {
    list-style: none;
    margin: 0;
    padding: 0;
}
.tool {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
}
.tool-name {
    color: var(--accent);
    font-size: 13px;
}
.tool p {
    margin-top: 2px;
}

.warning {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 13px;
}
.warning svg {
    margin-top: 2px;
}
</style>
