<script setup lang="ts">
import {MANUAL_REFRESH, REFRESH_PRESETS, type SourceType, type SourceView} from "#shared/types"
import {parseDriveFolderId} from "#shared/utils/drive"

// Fields of a source of one type. The type is fixed: it is chosen when adding and cannot change when editing.
const props = defineProps<{id: string; projectId: string; type: SourceType; source?: SourceView | null; projectHours: number}>()
const emit = defineEmits<{saved: [source: SourceView]}>()

const DOCS_INCLUDE = ["**/*.md", "**/*.mdx", "**/*.markdown", "**/*.txt", "**/*.rst", "**/*.adoc", "**/README*", "**/*.pdf", "**/*.{docx,pptx,xlsx}", "docs/**"]
/** Select value of "use the project's interval" (stored as null) */
const PROJECT_DEFAULT = "project"

const {run, pending} = useAction()

const s = props.source
const draft = ref({
    url: s?.url ?? "",
    title: s?.title ?? "",
    refresh: (s?.refreshIntervalHours ?? PROJECT_DEFAULT) as number | typeof PROJECT_DEFAULT,
    crawl: !!s?.options.crawl,
    maxPages: (s?.options.maxPages ?? 25) as number | string,
    branch: s?.options.branch ?? "",
    include: (s?.options.include ?? []).join("\n"),
    exclude: (s?.options.exclude ?? []).join("\n"),
    accessToken: "",
    removeToken: false,
    code: s?.options.code !== false,
    serviceAccountKey: "",
    removeKey: false
})
const urlError = ref("")
const isGit = computed(() => props.type === "git")
const isDrive = computed(() => props.type === "drive")
const includePlaceholder = computed(() => [...DOCS_INCLUDE, ...(draft.value.code ? ["+ source code and manifests"] : [])].join("\n"))

// The global service account email is fetched lazily, only for Drive sources
const globalDriveEmail = ref("")
let driveEmailLoaded = false
watch(
    isDrive,
    async (selected) => {
        if (!selected || driveEmailLoaded) return
        driveEmailLoaded = true
        try {
            const res = await $fetch<{email: string | null}>(`/api/projects/${props.projectId}/drive-account`)
            globalDriveEmail.value = res?.email ?? ""
        } catch {}
    },
    {immediate: true}
)
const serviceAccountEmail = computed(() => props.source?.options.serviceAccountEmail || globalDriveEmail.value)

const intervalOptions = computed(() => {
    const current = props.source?.refreshIntervalHours
    // A value set before the presets changed stays selectable
    const hours = [...new Set([...REFRESH_PRESETS, ...(current ? [current] : [])])].sort((a, b) => a - b)
    return [{value: PROJECT_DEFAULT, label: `Project default (${formatHours(props.projectHours)})`}, ...hours.map((h) => ({value: h, label: refreshIntervalLabel(h)})), {value: MANUAL_REFRESH, label: refreshIntervalLabel(MANUAL_REFRESH)}]
})
const refreshHint = computed(() =>
    draft.value.refresh === MANUAL_REFRESH || (draft.value.refresh === PROJECT_DEFAULT && props.projectHours === MANUAL_REFRESH) ? "Synced only when you click Sync." : "How often the source is fetched again to pick up changes."
)

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
        if (isGit.value && u.protocol !== "https:") urlError.value = "Use the https:// clone URL of the repository"
        else if (u.protocol !== "https:" && u.protocol !== "http:") urlError.value = "Only http(s) URLs are supported"
    } catch {
        urlError.value = isGit.value ? "Enter a URL like https://github.com/owner/repo" : "Enter a full URL like https://example.com/docs"
    }
    return !urlError.value
}

async function submit() {
    if (!validate()) return
    const d = draft.value
    const maxPages = Math.min(500, Math.max(1, Math.round(Number(d.maxPages) || 25)))
    const options =
        props.type === "url"
            ? {crawl: d.crawl, ...(d.crawl ? {maxPages} : {})}
            : props.type === "drive"
              ? {...(d.removeKey ? {serviceAccountKey: ""} : d.serviceAccountKey.trim() ? {serviceAccountKey: d.serviceAccountKey.trim()} : {})}
              : {
                    code: d.code,
                    branch: d.branch.trim(),
                    include: lines(d.include),
                    exclude: lines(d.exclude),
                    ...(d.removeToken ? {accessToken: ""} : d.accessToken.trim() ? {accessToken: d.accessToken.trim()} : {})
                }
    const body = {
        url: d.url.trim(),
        refreshIntervalHours: d.refresh === PROJECT_DEFAULT ? null : Number(d.refresh),
        options
    }
    const source = props.source
    const saved = await run(
        () =>
            source
                ? $fetch<SourceView>(`/api/projects/${props.projectId}/sources/${source._id}`, {method: "PATCH", body: {...body, title: d.title.trim()}})
                : $fetch<SourceView>(`/api/projects/${props.projectId}/sources`, {method: "POST", body: {...body, title: d.title.trim() || undefined, type: props.type}}),
        source ? "Source updated" : "Source added — first sync started"
    )
    if (saved) emit("saved", saved)
}

defineExpose({pending})
</script>

<template>
    <form :id="id" class="stack" style="--gap: 16px" @submit.prevent="submit">
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
        <UiSelect v-model="draft.refresh" label="Refresh" :options="intervalOptions" :hint="refreshHint" />

        <template v-if="type === 'url'">
            <div class="sub panel">
                <UiToggle v-model="draft.crawl" label="Crawl linked pages" description="Follow links on the same site below the start URL's folder, including PDFs, Office files and images (also uses sitemap.xml, respects robots.txt)." />
                <UiInput v-if="draft.crawl" v-model="draft.maxPages" type="number" label="Max pages" min="1" max="500" hint="1–500 pages per sync." />
            </div>
        </template>

        <template v-else-if="isDrive">
            <div class="sub panel">
                <p v-if="serviceAccountEmail" class="small muted">
                    Share the folder with <strong class="mono">{{ serviceAccountEmail }}</strong> (Viewer). All Google Docs, Slides, Sheets, Office files, PDFs, images and text files in it and its subfolders are indexed.
                </p>
                <UiCopy v-if="serviceAccountEmail" :value="serviceAccountEmail" label="Copy email" />
                <p v-else class="small warn-text">
                    No service account key is configured yet — set <code class="mono">NUXT_GOOGLE_SERVICE_ACCOUNT_KEY</code> on the server or paste a key below. Share the folder with the key's client_email (Viewer) so it can be read.
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
                <UiTextarea
                    v-model="draft.include"
                    label="Include"
                    optional
                    mono
                    :rows="5"
                    :placeholder="includePlaceholder"
                    hint="Glob patterns, one per line. PDFs, Office files (docx, pptx, xlsx) and images (PNG, JPEG, WebP, GIF) are converted to text."
                />
                <UiTextarea v-model="draft.exclude" label="Exclude" optional mono :rows="5" placeholder="changelog/**&#10;**/CHANGELOG.md" hint="Applied after include." />
            </div>
            <UiInput
                v-model="draft.accessToken"
                secret
                label="Access token"
                optional
                :disabled="draft.removeToken"
                :placeholder="source?.options.hasAccessToken ? '•••••••• (saved)' : 'ghp_… / glpat-…'"
                :hint="source?.options.hasAccessToken ? 'A token is saved — leave empty to keep it.' : 'Only for private repositories (read-only scope is enough). Never shown again.'"
            />
            <UiToggle v-if="source?.options.hasAccessToken" v-model="draft.removeToken" label="Remove saved token" />
        </template>
    </form>
</template>

<style scoped>
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
