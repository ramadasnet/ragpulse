<script setup lang="ts">
import {MessageCircleQuestionMark, Pencil, Plus, Search, Trash2, Upload} from "lucide-vue-next"
import type {Faq} from "#shared/types"

const props = defineProps<{projectId: string}>()

const {refresh: refreshProjects} = useProjects()
const {confirm} = useConfirm()
const {run} = useAction()

const {data, refresh, status, error} = useFetch<Faq[]>(() => `/api/projects/${props.projectId}/faqs`, {lazy: true, default: () => []})
const faqs = computed(() => data.value ?? [])

const query = ref("")
const filtered = computed(() => {
    const q = query.value.trim().toLowerCase()
    if (!q) return faqs.value
    return faqs.value.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))
})

const modalOpen = ref(false)
const importOpen = ref(false)
const editing = ref<Faq | null>(null)
const expanded = ref<Set<string>>(new Set())

function add() {
    editing.value = null
    modalOpen.value = true
}
function edit(f: Faq) {
    editing.value = f
    modalOpen.value = true
}
function toggle(id: string) {
    const next = new Set(expanded.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded.value = next
}

async function changed() {
    await refresh()
    refreshProjects().catch(() => {})
}

async function remove(f: Faq) {
    const ok = await confirm({title: "Delete FAQ?", message: `“${f.question}” will be removed from the knowledge base.`, confirmLabel: "Delete", danger: true})
    if (!ok) return
    const res = await run(() => $fetch<{ok: boolean}>(`/api/projects/${props.projectId}/faqs/${f._id}` as string, {method: "DELETE"}), "FAQ deleted")
    if (res) {
        data.value = faqs.value.filter((x) => x._id !== f._id)
        refreshProjects().catch(() => {})
    }
}
</script>

<template>
    <section class="stack" style="--gap: 14px">
        <div class="row between wrap">
            <label v-if="faqs.length" class="search control">
                <Search :size="15" class="dim" />
                <input v-model="query" type="search" placeholder="Search questions and answers" aria-label="Search FAQ" />
            </label>
            <p v-else class="muted small">Curated Q&amp;A pairs are indexed instantly and are often the most precise knowledge you can give the assistant.</p>
            <div class="row">
                <UiButton size="sm" variant="ghost" @click="importOpen = true"><Upload :size="15" /> Import</UiButton>
                <UiButton v-if="faqs.length" size="sm" variant="secondary" @click="add"><Plus :size="15" /> Add FAQ</UiButton>
            </div>
        </div>

        <div v-if="status === 'pending' && !faqs.length" class="stack" style="--gap: 8px">
            <div v-for="i in 3" :key="i" class="skeleton" style="height: 84px" />
        </div>

        <UiEmpty v-else-if="error" title="Could not load FAQ" :description="errorMessage(error)">
            <UiButton size="sm" @click="refresh()">Retry</UiButton>
        </UiEmpty>

        <UiEmpty v-else-if="!faqs.length" :icon="MessageCircleQuestionMark" title="No FAQ entries yet" description="Add the questions your customers ask most. Answers to unanswered questions can also be saved here.">
            <UiButton variant="primary" @click="add"><Plus :size="15" /> Add FAQ</UiButton>
            <UiButton variant="ghost" @click="importOpen = true"><Upload :size="15" /> Import</UiButton>
        </UiEmpty>

        <template v-else>
            <p class="dim tiny">{{ filtered.length }} of {{ faqs.length }} entr{{ faqs.length === 1 ? "y" : "ies" }}</p>
            <ul class="faq-list">
                <li v-for="f in filtered" :key="f._id" class="faq panel fade-in">
                    <div class="faq-head">
                        <h3 class="q">{{ f.question }}</h3>
                        <div class="row" style="--gap: 2px">
                            <UiButton size="sm" variant="ghost" icon :aria-label="`Edit “${f.question}”`" title="Edit" @click="edit(f)"><Pencil :size="15" /></UiButton>
                            <UiButton size="sm" variant="ghost" icon :aria-label="`Delete “${f.question}”`" title="Delete" @click="remove(f)"><Trash2 :size="15" /></UiButton>
                        </div>
                    </div>
                    <div class="answer" :class="{clamped: !expanded.has(f._id) && f.answer.length > 360}">
                        <KnowledgeMarkdown :source="f.answer" />
                    </div>
                    <div class="row between">
                        <button v-if="f.answer.length > 360" type="button" class="more" @click="toggle(f._id)">{{ expanded.has(f._id) ? "Show less" : "Show more" }}</button>
                        <span v-else />
                        <span class="row dim tiny" style="--gap: 10px">
                            <NuxtLink v-if="f.sessionId" :to="`/admin/projects/${projectId}/conversations/${f.sessionId}`" class="link">learned from a conversation</NuxtLink>
                            <span :title="formatDate(f.updatedAt, true)">updated {{ timeAgo(f.updatedAt) }}</span>
                        </span>
                    </div>
                </li>
            </ul>
            <p v-if="!filtered.length" class="muted small">No FAQ matches “{{ query }}”.</p>
        </template>

        <KnowledgeFaqModal v-model:open="modalOpen" :project-id="projectId" :faq="editing" @saved="changed" />
        <KnowledgeFaqImportModal v-model:open="importOpen" :project-id="projectId" @imported="changed" />
    </section>
</template>

<style scoped>
.search {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 380px;
    flex: 1;
    padding-top: 0;
    padding-bottom: 0;
}
.search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    outline: none;
    height: 36px;
}
.faq-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
}
.faq {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.faq-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}
.q {
    font-size: 14.5px;
    line-height: 1.4;
    padding-top: 4px;
}
.answer {
    color: var(--text-muted);
    font-size: 13.5px;
    position: relative;
}
.answer.clamped {
    max-height: 120px;
    overflow: hidden;
}
.answer.clamped::after {
    content: "";
    position: absolute;
    inset: auto 0 0;
    height: 48px;
    background: linear-gradient(transparent, var(--surface));
}
.more {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: 12.5px;
}
.more:hover {
    text-decoration: underline;
}
</style>
