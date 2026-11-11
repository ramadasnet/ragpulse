<script setup lang="ts">
import {GitBranch, Globe, HardDrive} from "lucide-vue-next"
import type {SourceType, SourceView} from "#shared/types"
import {parseDriveFolderId} from "#shared/utils/drive"

const open = defineModel<boolean>("open", {default: false})
const props = defineProps<{projectId: string; source?: SourceView | null; projectHours: number}>()
const emit = defineEmits<{saved: [source: SourceView]}>()

const DOCS_INCLUDE = ["**/*.md", "**/*.mdx", "**/*.markdown", "**/*.txt", "**/*.rst", "**/*.adoc", "**/README*", "**/*.pdf", "**/*.{docx,pptx,xlsx}", "docs/**"]
const INTERVALS = [1, 3, 6, 12, 24, 48, 72, 120, 168]
const typeOptions: Array<{id: SourceType; label: string; icon: typeof Globe}> = [
    {id: "url", label: "Website URL", icon: Globe},
    {id: "git", label: "Git repository", icon: GitBranch},
    {id: "drive", label: "Google Drive", icon: HardDrive}
]

const {run, pending} = useAction()
const editing = computed(() => !!props.source)

interface Draft {
    type: SourceType
    url: string
    title: string
    refresh: number
    crawl: boolean
    maxPages: number | string
    branch: string
    include: string
    exclude: string
    accessToken: string
    removeToken: boolean
    code: boolean
    serviceAccountKey: string
    removeKey: boolean
}

const draft = ref<Draft>({
    type: "url",
    url: "",
    title: "",
    refresh: 0,
    crawl: false,
    maxPages: 25,
    branch: "",
    include: "",
    exclude: "",
    accessToken: "",
    removeToken: false,
    code: true,
    serviceAccountKey: "",
    removeKey: false
})
const urlError = ref("")
const isGit = computed(() => draft.value.type === "git")
const isDrive = computed(() => draft.value.type === "drive")
const crawlOn = computed(() => draft.value.crawl)
const includePlaceholder = computed(() => [...DOCS_INCLUDE, ...(draft.value.code ? ["+ source code and manifests"] : [])].join("\n"))
const isType = (id: SourceType) => draft.value.type === id
const setType = (id: SourceType) => {
    draft.value.type = id
}

watch(
    open,
    (isOpen) => {
        if (!isOpen) return
        const s = props.source
        urlError.value = ""
        draft.value = {
            type: s?.type ?? "url",
            url: s?.url ?? "",
            title: s?.title ?? "",
            refresh: s?.refreshIntervalHours ?? 0,
            crawl: !!s?.options.crawl,
            maxPages: s?.options.maxPages ?? 25,
            branch: s?.options.branch ?? "",
            include: (s?.options.include ?? []).join("\n"),
            exclude: (s?.options.exclude ?? []).join("\n"),
            accessToken: "",
            removeToken: false,
            code: s?.options.code !== false,
            serviceAccountKey: "",
            removeKey: false
        }
    },
    {immediate: true}
)

// The global service account email is fetched lazily, only when the Drive type is selected
const globalDriveEmail = ref("")
let driveEmailLoaded = false
watch(isDrive, async (selected) => {
    if (!selected || driveEmailLoaded) return
    driveEmailLoaded = true
    try {
        const res = await $fetch<{email: string | null}>(`/api/projects/${props.projectId}/drive-account`)
        globalDriveEmail.value = res?.email ?? ""
    } catch {}
})
const serviceAccountEmail = computed(() => props.source?.options.serviceAccountEmail || globalDriveEmail.value)

function intervalLabel(h: number) {
    const label = formatHours(h)
    return label.charAt(0).toUpperCase() + label.slice(1)
}

const intervalOptions = computed(() => {
    const values = new Set(INTERVALS)
    if (draft.value.refresh && !values.has(draft.value.refresh)) values.add(draft.value.refresh)
    return [{value: 0, label: `Project default (${formatHours(props.projectHours)})`}, ...[...values].sort((a, b) => a - b).map((h) => ({value: h, label: intervalLabel(h)}))]
})

const lines = (text: string) =>
    text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)

function validate(): boolean {
    urlError.value = ""
    const value = draft.value.url.trim()
    if (!value) {
        urlError.value = isDrive.value ? "Folder link is required" : "URL is required"
        return false
    }
    if (isDrive.value) {
        if (!parseDriveFolderId(value)) urlError.value = "Enter a Google Drive folder link like https://drive.google.com/drive/folders/…"
        return !urlError.value
    }
    try {
        const u = new URL(value)
        if (draft.value.type === "git" && u.protocol !== "https:") urlError.value = "Use the https:// clone URL of the repository"
        else if (u.protocol !== "https:" && u.protocol !== "http:") urlError.value = "Only http(s) URLs are supported"
    } catch {
        urlError.value = draft.value.type === "git" ? "Enter a URL like https://github.com/owner/repo" : "Enter a full URL like https://example.com/docs"
    }
    return !urlError.value
}

async function submit() {
    if (!validate()) return
    const maxPages = Math.min(500, Math.max(1, Math.round(Number(draft.value.maxPages) || 25)))
    const options =
        draft.value.type === "url"
            ? {crawl: draft.value.crawl, ...(draft.value.crawl ? {maxPages} : {})}
            : draft.value.type === "drive"
              ? {...(draft.value.removeKey ? {serviceAccountKey: ""} : draft.value.serviceAccountKey.trim() ? {serviceAccountKey: draft.value.serviceAccountKey.trim()} : {})}
              : {
                    code: draft.value.code,
                    branch: draft.value.branch.trim(),
                    include: lines(draft.value.include),
                    exclude: lines(draft.value.exclude),
                    ...(draft.value.removeToken ? {accessToken: ""} : draft.value.accessToken.trim() ? {accessToken: draft.value.accessToken.trim()} : {})
                }
    const body = {
        url: draft.value.url.trim(),
        title: draft.value.title.trim() || undefined,
        refreshIntervalHours: draft.value.refresh ? Number(draft.value.refresh) : null,
        options
    }
    const saved = await run(
        () =>
            props.source
                ? $fetch<SourceView>(`/api/projects/${props.projectId}/sources/${props.source._id}`, {method: "PATCH", body: {...body, title: draft.value.title.trim()}})
                : $fetch<SourceView>(`/api/projects/${props.projectId}/sources`, {method: "POST", body: {...body, type: draft.value.type}}),
        props.source ? "Source updated" : "Source added — first sync started"
    )
    if (saved) {
        emit("saved", saved)
        open.value = false
    }
}
</script>

<template>
    <UiModal v-model:open="open" :title="editing ? 'Edit source' : 'Add source'" :description="editing ? undefined : 'Index a website, a git repository or a Google Drive folder. Content is converted to markdown, chunked and embedded.'" width="600px">
        <form id="source-form" class="stack" style="--gap: 16px" @submit.prevent="submit">
            <div class="segmented" role="radiogroup" aria-label="Source type">
                <button v-for="t in typeOptions" :key="t.id" type="button" role="radio" :aria-checked="isType(t.id)" :disabled="editing && !isType(t.id)" class="seg" :class="{active: isType(t.id)}" @click="setType(t.id)">
                    <component :is="t.icon" :size="15" /> {{ t.label }}
                </button>
            </div>

            <UiInput
                v-model="draft.url"
                :label="isGit ? 'Repository URL' : isDrive ? 'Folder link' : 'Page URL'"
                :placeholder="isGit ? 'https://github.com/acme/docs' : isDrive ? 'https://drive.google.com/drive/folders/…' : 'https://example.com/docs/'"
                :error="urlError"
                :hint="isGit ? 'https clone URL. GitHub, GitLab, Bitbucket and Codeberg files get links in answers.' : undefined"
                inputmode="url"
                autocomplete="off"
                required
            />
            <UiInput v-model="draft.title" label="Title" optional placeholder="Derived from the URL" maxlength="200" />
            <UiSelect v-model="draft.refresh" label="Refresh" :options="intervalOptions" hint="How often the source is fetched again to pick up changes." />

            <template v-if="draft.type === 'url'">
                <div class="sub panel">
                    <UiToggle v-model="draft.crawl" label="Crawl linked pages" description="Follow links on the same site below the start URL's folder, including PDFs, Office files and images (also uses sitemap.xml, respects robots.txt)." />
                    <UiInput v-if="crawlOn" v-model="draft.maxPages" type="number" label="Max pages" min="1" max="500" hint="1–500 pages per sync." />
                </div>
            </template>

            <template v-else-if="isDrive">
                <div class="sub panel">
                    <p v-if="serviceAccountEmail" class="small muted">
                        Share the folder with <strong class="mono">{{ serviceAccountEmail }}</strong> (Viewer). All Google Docs, Slides, Sheets, Office files, PDFs, images and text files in it
                        and its subfolders are indexed.
                    </p>
                    <UiCopy v-if="serviceAccountEmail" :value="serviceAccountEmail" label="Copy email" />
                    <p v-else class="small warn-text">
                        No service account key is configured yet — set <code class="mono">NUXT_GOOGLE_SERVICE_ACCOUNT_KEY</code> on the server or paste a key below. Share the folder with the
                        key's client_email (Viewer) so it can be read.
                    </p>
                    <UiTextarea
                        v-model="draft.serviceAccountKey"
                        label="Service account key"
                        optional
                        mono
                        :rows="3"
                        :disabled="draft.removeKey"
                        :placeholder="source?.options.hasServiceAccountKey ? '•••••••• (saved)' : '{&quot;type&quot;: &quot;service_account&quot;, …} (JSON or base64)'"
                        :hint="source?.options.hasServiceAccountKey ? 'A key is saved — leave empty to keep it.' : 'Overrides the server key for this source. Never shown again.'"
                    />
                    <UiToggle v-if="source?.options.hasServiceAccountKey" v-model="draft.removeKey" label="Remove saved key" />
                </div>
            </template>

            <template v-else>
                <UiInput v-model="draft.branch" label="Branch" optional placeholder="Default branch" autocomplete="off" />
                <div class="sub panel">
                    <UiToggle
                        v-model="draft.code"
                        label="Index source code"
                        description="Includes code files and build manifests (tests and generated files are skipped). Each file is summarized with the whole repository as context, plus an overview of how the application works, so the assistant can answer technical questions."
                    />
                </div>
                <div class="grid-2">
                    <UiTextarea v-model="draft.include" label="Include" optional mono :rows="5" :placeholder="includePlaceholder" hint="Glob patterns, one per line. PDFs, Office files (docx, pptx, xlsx) and images (PNG, JPEG, WebP, GIF) are converted to text." />
                    <UiTextarea v-model="draft.exclude" label="Exclude" optional mono :rows="5" placeholder="changelog/**&#10;**/CHANGELOG.md" hint="Applied after include." />
                </div>
                <UiInput
                    v-model="draft.accessToken"
                    type="password"
                    label="Access token"
                    optional
                    autocomplete="new-password"
                    :disabled="draft.removeToken"
                    :placeholder="source?.options.hasAccessToken ? '•••••••• (saved)' : 'ghp_… / glpat-…'"
                    :hint="source?.options.hasAccessToken ? 'A token is saved — leave empty to keep it.' : 'Only for private repositories (read-only scope is enough). Never shown again.'"
                />
                <UiToggle v-if="source?.options.hasAccessToken" v-model="draft.removeToken" label="Remove saved token" />
            </template>
        </form>

        <template #footer>
            <UiButton variant="ghost" @click="open = false">Cancel</UiButton>
            <UiButton variant="primary" type="submit" form="source-form" :loading="pending">{{ editing ? "Save changes" : "Add & sync" }}</UiButton>
        </template>
    </UiModal>
</template>

<style scoped>
.segmented {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.seg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 34px;
    border-radius: 8px;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    font-weight: 500;
    transition:
        background 0.15s var(--ease),
        color 0.15s var(--ease);
}
.seg:hover:not(:disabled) {
    color: var(--text);
}
.seg.active {
    background: var(--surface-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border-strong);
}
.seg:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.sub {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bg-elev);
}
.warn-text {
    color: var(--warning);
}
</style>
