<script setup lang="ts">
import {AlertTriangle, Bot, Code2, Eraser, KeyRound, Mail, ShieldCheck, Sparkles} from "lucide-vue-next"
import type {AppSettingsView, EmbeddingStatus} from "#shared/types"
import {ANSWER_EMAIL_MAX_DELAY_MINUTES, CHAT_AUTO_CLOSE_MAX_DAYS, HUMAN_TAKEOVER_MAX_WAIT_MINUTES, QUESTION_RETENTION_MAX_DAYS, SYNC_HISTORY_MAX_DAYS} from "#shared/types"
import {DEFAULT_GLOBAL_INSTRUCTIONS} from "#shared/utils/instructions"

interface SettingsResponse {
    settings: AppSettingsView
    defaults: {userAgent: string}
    embedding: EmbeddingStatus
    vectorMode: "atlas" | "fallback" | "unknown"
    projectCount: number
}

const {isAdmin} = useMe()
if (!isAdmin.value) await navigateTo("/admin", {replace: true})
useHead({title: "Global Settings · RAGPulse"})

const {confirm} = useConfirm()
const {data, error, refresh} = useFetch<SettingsResponse>("/api/system/settings", {lazy: true, server: false, immediate: isAdmin.value})

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname
    } catch {
        return false
    }
}

interface Form {
    customAiProvider: boolean
    /** Empty = keep the saved key */
    openrouterApiKey: string
    removeOpenrouterApiKey: boolean
    aiProviderBaseUrl: string
    /** Empty = keep the saved key */
    aiProviderApiKey: string
    removeAiProviderApiKey: boolean
    embeddingModel: string
    /** Empty = the model's native size */
    embeddingDimensions: string
    summarize: boolean
    codeSummaryModel: string
    userAgent: string
    requestIntervalMs: number | string
    syncHistoryDays: number | string
    questionRetentionDays: number | string
    globalInstructions: string
    answerEmailDelayMinutes: number | string
    humanTakeoverWaitMinutes: number | string
    chatAutoCloseDays: number | string
}

function toForm(s: AppSettingsView): Form {
    return {
        customAiProvider: s.customAiProvider,
        openrouterApiKey: "",
        removeOpenrouterApiKey: false,
        aiProviderBaseUrl: s.aiProviderBaseUrl,
        aiProviderApiKey: "",
        removeAiProviderApiKey: false,
        embeddingModel: s.embeddingModel,
        embeddingDimensions: s.embeddingDimensionsParam ? String(s.embeddingDimensions) : "",
        summarize: !!s.codeSummaryModel,
        codeSummaryModel: s.codeSummaryModel || "openrouter/free",
        userAgent: s.userAgent,
        requestIntervalMs: s.requestIntervalMs,
        syncHistoryDays: s.syncHistoryDays,
        questionRetentionDays: s.questionRetentionDays,
        globalInstructions: s.globalInstructions,
        answerEmailDelayMinutes: s.answerEmailDelayMinutes,
        humanTakeoverWaitMinutes: s.humanTakeoverWaitMinutes,
        chatAutoCloseDays: s.chatAutoCloseDays
    }
}

const form = ref<Form | null>(null)
const original = ref("")
watch(
    () => data.value?.settings,
    (s) => {
        if (!s) return
        // Polling refreshes `data`: keep edits in progress
        if (form.value && JSON.stringify(form.value) !== original.value) return
        form.value = toForm(s)
        original.value = JSON.stringify(form.value)
    },
    {immediate: true}
)

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
    const baseUrl = f.aiProviderBaseUrl.trim()
    if (f.customAiProvider) {
        if (!baseUrl) e.aiProviderBaseUrl = "Base URL is required"
        else if (!isHttpUrl(baseUrl)) e.aiProviderBaseUrl = "Enter a valid http(s) URL"
    }
    if (!f.embeddingModel.trim()) e.embeddingModel = "Choose an embedding model"
    const dims = f.embeddingDimensions.trim()
    if (dims && (!/^\d+$/.test(dims) || Number(dims) < 32 || Number(dims) > 8192)) e.embeddingDimensions = "A whole number between 32 and 8192, or empty"
    if (f.summarize && !f.codeSummaryModel.trim()) e.codeSummaryModel = "Choose a model"
    if (f.userAgent && !/^[\x20-\x7E]*$/.test(f.userAgent)) e.userAgent = "Only printable ASCII characters"
    const interval = Number(f.requestIntervalMs)
    if (!Number.isInteger(interval) || interval < 0 || interval > 60_000) e.requestIntervalMs = "Between 0 and 60000 ms"
    const days = Number(f.syncHistoryDays)
    if (!Number.isInteger(days) || days < 1 || days > SYNC_HISTORY_MAX_DAYS) e.syncHistoryDays = `Between 1 and ${SYNC_HISTORY_MAX_DAYS} days`
    const questionDays = Number(f.questionRetentionDays)
    if (!Number.isInteger(questionDays) || questionDays < 0 || questionDays > QUESTION_RETENTION_MAX_DAYS) e.questionRetentionDays = `Between 0 and ${QUESTION_RETENTION_MAX_DAYS} days`
    const delay = Number(f.answerEmailDelayMinutes)
    if (!Number.isInteger(delay) || delay < 0 || delay > ANSWER_EMAIL_MAX_DELAY_MINUTES) e.answerEmailDelayMinutes = `Between 0 and ${ANSWER_EMAIL_MAX_DELAY_MINUTES} minutes`
    const wait = Number(f.humanTakeoverWaitMinutes)
    if (!Number.isInteger(wait) || wait < 0 || wait > HUMAN_TAKEOVER_MAX_WAIT_MINUTES) e.humanTakeoverWaitMinutes = `Between 0 and ${HUMAN_TAKEOVER_MAX_WAIT_MINUTES} minutes`
    const closeDays = Number(f.chatAutoCloseDays)
    if (!Number.isInteger(closeDays) || closeDays < 0 || closeDays > CHAT_AUTO_CLOSE_MAX_DAYS) e.chatAutoCloseDays = `Between 0 and ${CHAT_AUTO_CLOSE_MAX_DAYS} days`
    if (f.globalInstructions.trim().length > 20_000) e.globalInstructions = "At most 20000 characters"
    return e
})
const valid = computed(() => Object.keys(errors.value).length === 0)

const openrouterKeyHint = computed(() => {
    const s = data.value?.settings
    if (!s) return ""
    if (s.savedOpenrouterApiKey) return "A key is saved here — leave empty to keep it. Removing it falls back to NUXT_OPENROUTER_API_KEY."
    if (s.envOpenrouterApiKey) return "A key is configured via NUXT_OPENROUTER_API_KEY — enter one here to override it."
    return "Required for chat and embeddings. Or set NUXT_OPENROUTER_API_KEY on the server."
})
const aiProviderKeyHint = computed(() => {
    const s = data.value?.settings
    if (!s) return ""
    if (s.savedAiProviderApiKey) return "A key is saved here — leave empty to keep it. Removing it falls back to NUXT_AI_PROVIDER_API_KEY."
    if (s.envAiProviderApiKey) return "A key is configured via NUXT_AI_PROVIDER_API_KEY — enter one here to override it."
    return "Sent as Bearer token. Leave empty for endpoints without authentication (most local servers)."
})
const aiProviderBaseUrlPlaceholder = "https://api.openai.com/v1"
const aiProviderBaseUrlHint = `The OpenAI-compatible endpoint, without /chat/completions or /embeddings — e.g. ${aiProviderBaseUrlPlaceholder} or http://localhost:11434/v1.`

const embedding = computed(() => data.value?.embedding)
const reembedding = computed(() => !!embedding.value && embedding.value.current < embedding.value.total)
const progress = computed(() => (embedding.value?.total ? Math.floor((embedding.value.current / embedding.value.total) * 100) : 100))

let poll: ReturnType<typeof setInterval> | undefined
watch(
    reembedding,
    (busy) => {
        if (busy && !poll) poll = setInterval(() => refresh(), 4000)
        else if (!busy && poll) {
            clearInterval(poll)
            poll = undefined
        }
    },
    {immediate: true}
)
onBeforeUnmount(() => clearInterval(poll))

const {run, pending} = useAction()

async function save() {
    const f = form.value
    if (!f || !valid.value || !data.value) return
    if (embeddingChanged.value) {
        const projects = data.value.projectCount
        const ok = await confirm({
            title: "Change the embedding model?",
            message: `All knowledge of ${projects === 1 ? "the project" : `all ${formatNumber(projects)} projects`} (${formatNumber(data.value.embedding.total)} chunks) has to be re-indexed with “${f.embeddingModel.trim()}”. This runs in the background and is billed by the AI provider. Until it finishes, answers only use the knowledge that has already been re-indexed.`,
            confirmLabel: "Change model & re-index",
            danger: true
        })
        if (!ok) return
    }
    const saved = await run(
        () =>
            $fetch<SettingsResponse>("/api/system/settings", {
                method: "PATCH",
                body: {
                    customAiProvider: f.customAiProvider,
                    ...(f.customAiProvider ? {aiProviderBaseUrl: f.aiProviderBaseUrl.trim()} : {}),
                    ...(f.removeOpenrouterApiKey ? {openrouterApiKey: ""} : f.openrouterApiKey.trim() ? {openrouterApiKey: f.openrouterApiKey.trim()} : {}),
                    ...(f.removeAiProviderApiKey ? {aiProviderApiKey: ""} : f.aiProviderApiKey.trim() ? {aiProviderApiKey: f.aiProviderApiKey.trim()} : {}),
                    ...(embeddingChanged.value ? {embeddingModel: f.embeddingModel.trim(), embeddingDimensions: f.embeddingDimensions.trim() ? Number(f.embeddingDimensions) : null} : {}),
                    codeSummaryModel: f.summarize ? f.codeSummaryModel.trim() : "",
                    userAgent: f.userAgent.trim(),
                    requestIntervalMs: Number(f.requestIntervalMs),
                    syncHistoryDays: Number(f.syncHistoryDays),
                    questionRetentionDays: Number(f.questionRetentionDays),
                    globalInstructions: f.globalInstructions.trim(),
                    answerEmailDelayMinutes: Number(f.answerEmailDelayMinutes),
                    humanTakeoverWaitMinutes: Number(f.humanTakeoverWaitMinutes),
                    chatAutoCloseDays: Number(f.chatAutoCloseDays)
                }
            }),
        embeddingChanged.value ? "Settings saved — re-indexing started" : "Settings saved"
    )
    if (!saved) return
    form.value = toForm(saved.settings)
    original.value = JSON.stringify(form.value)
    data.value = saved
    // Model lists of the previous provider would be stale
    useState("openrouter-models", () => null).value = null
    useState("openrouter-embedding-models", () => null).value = null
}

function discard() {
    if (data.value) form.value = toForm(data.value.settings)
}

onBeforeRouteLeave(async () => {
    if (!dirty.value) return true
    return confirm({title: "Discard changes?", message: "You have unsaved changes on this page.", confirmLabel: "Discard", danger: true})
})
function onBeforeUnload(e: BeforeUnloadEvent) {
    if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener("beforeunload", onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener("beforeunload", onBeforeUnload))
</script>

<template>
    <div class="page narrow">
        <header class="page-header">
            <div>
                <p class="eyebrow">Workspace</p>
                <h1>Global Settings</h1>
                <p>The AI provider, global instructions, embeddings, source code summaries, the website crawler and data cleanup, for all projects.</p>
            </div>
        </header>

        <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

        <div v-else-if="!form || !data" class="stack" style="--gap: 16px">
            <div v-for="i in 3" :key="i" class="panel panel-pad stack">
                <div class="skeleton" style="width: 30%; height: 16px" />
                <div class="skeleton" style="height: 38px" />
            </div>
        </div>

        <form v-else class="stack sections" style="--gap: 16px" novalidate @submit.prevent="save">
            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <ShieldCheck :size="16" class="dim" />
                        <h2 class="card-title">Global system instructions</h2>
                    </div>
                </template>
                <div class="stack" style="--gap: 16px">
                    <p class="small muted">Base security rules for the assistant of every project. They are added to every answer and take precedence over the instructions of each project.</p>
                    <UiTextarea
                        v-model="form.globalInstructions"
                        label="Instructions"
                        optional
                        :rows="12"
                        mono
                        maxlength="20000"
                        :error="errors.globalInstructions"
                        hint="Leave empty to disable. The default protects credentials, secrets and personal information, and resists prompt injection."
                    >
                        <template #aside>
                            <button v-if="form.globalInstructions.trim() !== DEFAULT_GLOBAL_INSTRUCTIONS" type="button" class="link-btn tiny" @click="form.globalInstructions = DEFAULT_GLOBAL_INSTRUCTIONS">Reset to default</button>
                        </template>
                    </UiTextarea>
                </div>
            </UiCard>

            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <KeyRound :size="16" class="dim" />
                        <h2 class="card-title">AI Provider</h2>
                    </div>
                </template>
                <div class="stack" style="--gap: 16px">
                    <p class="small muted">The API used for chat answers and embeddings, for every project.</p>
                    <UiToggle v-model="form.customAiProvider" label="Use a custom AI provider" description="Send requests to any OpenAI-compatible endpoint instead of OpenRouter." />
                    <div v-if="!form.customAiProvider" class="stack" style="--gap: 16px">
                        <UiInput
                            v-model="form.openrouterApiKey"
                            type="password"
                            label="OpenRouter API key"
                            optional
                            autocomplete="new-password"
                            :disabled="form.removeOpenrouterApiKey"
                            :placeholder="data.settings.hasOpenrouterApiKey ? '•••••••• (configured)' : 'sk-or-…'"
                            :hint="openrouterKeyHint"
                        />
                        <UiToggle v-if="data.settings.savedOpenrouterApiKey" v-model="form.removeOpenrouterApiKey" label="Remove saved key" />
                    </div>
                    <div v-else class="stack" style="--gap: 16px">
                        <UiInput v-model="form.aiProviderBaseUrl" label="Base URL" inputmode="url" autocomplete="off" :placeholder="aiProviderBaseUrlPlaceholder" :error="errors.aiProviderBaseUrl" :hint="aiProviderBaseUrlHint" />
                        <UiInput
                            v-model="form.aiProviderApiKey"
                            type="password"
                            label="API key"
                            optional
                            autocomplete="new-password"
                            :disabled="form.removeAiProviderApiKey"
                            :placeholder="data.settings.hasAiProviderApiKey ? '•••••••• (configured)' : 'sk-…'"
                            :hint="aiProviderKeyHint"
                        />
                        <UiToggle v-if="data.settings.savedAiProviderApiKey" v-model="form.removeAiProviderApiKey" label="Remove saved key" />
                    </div>
                </div>
            </UiCard>

            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <Sparkles :size="16" class="dim" />
                        <h2 class="card-title">Embeddings</h2>
                    </div>
                </template>
                <div class="stack" style="--gap: 16px">
                    <p class="small muted">Turns knowledge and visitor questions into vectors for retrieval. Applies to every project.</p>

                    <div v-if="reembedding" class="notice info" role="status" aria-live="polite">
                        <div class="row between" style="--gap: 12px">
                            <p class="small strong">
                                Re-indexing knowledge with <span class="mono">{{ embedding?.model }}</span>
                            </p>
                            <span class="small mono nowrap">{{ progress }}%</span>
                        </div>
                        <div class="bar" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100"><span :style="{width: `${Math.max(2, progress)}%`}" /></div>
                        <p class="tiny dim">{{ formatNumber(embedding?.current ?? 0) }} of {{ formatNumber(embedding?.total ?? 0) }} chunks done. Answers use the re-indexed knowledge only until this finishes.</p>
                    </div>

                    <AdminModelPicker v-model="form.embeddingModel" kind="embedding" label="Embedding model" hint="Any embedding model of the configured provider. Prices are USD per 1M tokens, shown when the provider reports them." />
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
                                Vectors from different models can't be compared, so the knowledge of {{ data.projectCount === 1 ? "the project" : `all ${formatNumber(data.projectCount)} projects` }} ({{ formatNumber(data.embedding.total) }} chunks)
                                is re-embedded in the background after you save. This is billed by the AI provider, and until it finishes answers only use the knowledge that has already been re-indexed. The model is tested before it's applied.
                            </p>
                        </div>
                    </div>
                    <p v-else class="tiny dim">
                        Current: <span class="mono">{{ data.settings.embeddingModel }}</span> · {{ data.settings.embeddingDimensions }} dimensions ·
                        {{ data.vectorMode === "atlas" ? "Atlas Vector Search" : data.vectorMode === "fallback" ? "in-app similarity" : "vector search unknown" }}
                    </p>
                </div>
            </UiCard>

            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <Code2 :size="16" class="dim" />
                        <h2 class="card-title">Source code summaries</h2>
                    </div>
                </template>
                <div class="stack" style="--gap: 16px">
                    <UiToggle
                        v-model="form.summarize"
                        label="Summarize source code of git repositories"
                        description="Each code file is summarized with the whole repository as context, and an overview of how the application works is written from all summaries. Helps the assistant answer technical questions. Summaries are cached: unchanged files are never sent twice."
                    />
                    <template v-if="form.summarize">
                        <AdminModelPicker v-model="form.codeSummaryModel" label="Summary model" hint="A fast model with a large context window works best. Prices are USD per 1M input / output tokens, shown when the provider reports them." />
                        <p v-if="errors.codeSummaryModel" class="field-error">{{ errors.codeSummaryModel }}</p>
                    </template>
                    <p v-else class="tiny dim">Code files are still indexed as plain code when a repository source includes them.</p>
                </div>
            </UiCard>

            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <Bot :size="16" class="dim" />
                        <h2 class="card-title">Website crawler</h2>
                    </div>
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
                    <div class="row" style="--gap: 8px">
                        <Eraser :size="16" class="dim" />
                        <h2 class="card-title">Cleanup</h2>
                    </div>
                </template>
                <div class="stack" style="--gap: 16px">
                    <UiInput
                        v-model.number="form.chatAutoCloseDays"
                        type="number"
                        :min="0"
                        :max="CHAT_AUTO_CLOSE_MAX_DAYS"
                        label="Close inactive conversations (days)"
                        :error="errors.chatAutoCloseDays"
                        hint="Conversations without messages for this many days are closed: the visitor gets a new chat and the team can no longer reply in them. 0 keeps them open."
                    />
                    <UiInput
                        v-model.number="form.syncHistoryDays"
                        type="number"
                        :min="1"
                        :max="SYNC_HISTORY_MAX_DAYS"
                        label="Keep sync history (days)"
                        :error="errors.syncHistoryDays"
                        hint="Every source sync records the number of files, total size and duration, shown in each source's history. Older runs are deleted automatically."
                    />
                    <UiInput
                        v-model.number="form.questionRetentionDays"
                        type="number"
                        :min="0"
                        :max="QUESTION_RETENTION_MAX_DAYS"
                        label="Keep escalated questions (days)"
                        :error="errors.questionRetentionDays"
                        hint="Escalated questions older than this are deleted automatically, 0 keeps them forever. FAQ entries created from answers or learned from conversations are kept."
                    />
                </div>
            </UiCard>

            <UiCard>
                <template #header>
                    <div class="row" style="--gap: 8px">
                        <Mail :size="16" class="dim" />
                        <h2 class="card-title">Escalation & emails</h2>
                    </div>
                </template>
                <div class="stack" style="--gap: 16px">
                    <UiInput
                        v-model.number="form.humanTakeoverWaitMinutes"
                        type="number"
                        :min="0"
                        :max="HUMAN_TAKEOVER_MAX_WAIT_MINUTES"
                        label="Human takeover wait (minutes)"
                        :error="errors.humanTakeoverWaitMinutes"
                        hint="When a question is escalated, the chat asks for the visitor's name and email right away and waits this long for a team member to take over. If nobody does, the assistant says the team will get back by email (projects without a support email only ask for the visitor's details). 0 = say it right away."
                    />
                    <UiInput
                        v-model.number="form.answerEmailDelayMinutes"
                        type="number"
                        :min="0"
                        :max="ANSWER_EMAIL_MAX_DELAY_MINUTES"
                        label="Email delay (minutes)"
                        :error="errors.answerEmailDelayMinutes"
                        hint="When the team answers a question and the visitor isn't looking at the chat, the answer is emailed after this delay, unless they open the chat meanwhile. Visitors who are in the chat are never emailed. 0 = email right away."
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
.sections {
    padding-bottom: 72px;
}
.card-title {
    font-size: 15px;
}
.notice {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-elev);
}
.notice.warn {
    border-color: rgb(251 191 36 / 0.35);
    background: var(--warning-soft);
}
.notice.info {
    flex-direction: column;
    gap: 8px;
}
.warn-icon {
    color: var(--warning);
    flex-shrink: 0;
    margin-top: 1px;
}
.bar {
    height: 6px;
    border-radius: 6px;
    background: var(--surface-2);
    overflow: hidden;
}
.bar span {
    display: block;
    height: 100%;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--accent), var(--violet));
    transition: width 0.4s var(--ease);
}
.savebar {
    position: sticky;
    bottom: 16px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 10px 16px;
    background: rgb(19 22 28 / 0.92);
    backdrop-filter: blur(10px);
    box-shadow: var(--shadow-lg);
    border-color: var(--border-strong);
}
.bar-enter-active,
.bar-leave-active {
    transition:
        opacity 0.18s var(--ease),
        transform 0.18s var(--ease);
}
.bar-enter-from,
.bar-leave-to {
    opacity: 0;
    transform: translateY(10px);
}
</style>
