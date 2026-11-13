<script setup lang="ts">
import {ExternalLink, FlaskConical, GitBranch, Globe, HardDrive, MessageCircleQuestionMark, Search} from "lucide-vue-next"
import type {ChunkSourceType} from "#shared/types"

interface Hit {
    _id: string
    sourceType: ChunkSourceType
    title: string
    url?: string
    heading?: string
    content: string
    score: number
}

const props = defineProps<{projectId: string}>()
const {run, pending} = useAction()

const query = ref("")
const limit = ref(8)
const hits = ref<Hit[] | null>(null)
const lastQuery = ref("")
const expanded = ref<Set<string>>(new Set())

async function search() {
    const q = query.value.trim()
    if (!q) return
    const res = await run(() => $fetch<Hit[]>(`/api/projects/${props.projectId}/search`, {method: "POST", body: {query: q, limit: limit.value}}))
    if (res) {
        hits.value = res
        lastQuery.value = q
        expanded.value = new Set()
    }
}

function toggle(id: string) {
    const next = new Set(expanded.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded.value = next
}

/** Chunk content without the breadcrumb line (already shown as title/heading). */
function body(hit: Hit) {
    const i = hit.content.indexOf("\n\n")
    return i > 0 && i < 300 && hit.sourceType !== "faq" ? hit.content.slice(i + 2) : hit.content
}

function tone(score: number) {
    return score >= 0.5 ? "high" : score >= 0.3 ? "mid" : "low"
}

const icons = {url: Globe, git: GitBranch, drive: HardDrive, faq: MessageCircleQuestionMark} as const
const limitOptions = [5, 8, 12, 20].map((v) => ({value: v, label: `Top ${v}`}))
</script>

<template>
    <section class="stack" style="--gap: 16px">
        <form class="query panel" role="search" @submit.prevent="search">
            <Search :size="16" class="dim" />
            <input v-model="query" type="search" class="grow" placeholder="Ask something a visitor would ask…" aria-label="Test query" maxlength="2000" />
            <UiSelect v-model="limit" :options="limitOptions" aria-label="Number of results" class="limit" />
            <UiButton variant="primary" type="submit" :loading="pending" :disabled="!query.trim()">Search</UiButton>
        </form>

        <UiEmpty v-if="hits === null" :icon="FlaskConical" title="Test retrieval" description="See which knowledge chunks the assistant would receive for a question, ranked by semantic similarity. Use it to verify indexing and spot gaps." />

        <UiEmpty v-else-if="!hits.length" title="No results" :description="`Nothing indexed matches “${lastQuery}”. Add a source or FAQ entry that covers it.`" />

        <ol v-else class="hits">
            <li v-for="(h, i) in hits" :key="h._id" class="hit panel fade-in">
                <div class="hit-head">
                    <span class="rank dim mono">#{{ i + 1 }}</span>
                    <span class="kind" :class="h.sourceType" :title="h.sourceType"><component :is="icons[h.sourceType] ?? Globe" :size="14" /></span>
                    <div class="grow" style="min-width: 0">
                        <p class="strong truncate">
                            <a v-if="h.url" :href="h.url" target="_blank" rel="noopener" class="title-link">{{ h.title }} <ExternalLink :size="12" class="dim" /></a>
                            <template v-else>{{ h.title }}</template>
                        </p>
                        <p v-if="h.heading && h.sourceType !== 'faq'" class="dim tiny truncate">{{ h.heading }}</p>
                    </div>
                    <div class="score" :class="tone(h.score)" :title="`Cosine similarity ${h.score.toFixed(4)}`">
                        <div class="bar" role="meter" :aria-valuenow="Number(h.score.toFixed(3))" aria-valuemin="0" aria-valuemax="1" :aria-label="`Score ${h.score.toFixed(3)}`">
                            <span :style="{width: `${Math.max(0, Math.min(1, h.score)) * 100}%`}" />
                        </div>
                        <span class="mono small">{{ h.score.toFixed(3) }}</span>
                    </div>
                </div>
                <p class="content pre-wrap small" :class="{clamped: !expanded.has(h._id)}">{{ body(h) }}</p>
                <button v-if="body(h).length > 420" type="button" class="more" @click="toggle(h._id)">{{ expanded.has(h._id) ? "Show less" : "Show full chunk" }}</button>
            </li>
        </ol>
    </section>
</template>

<style scoped>
.query {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 14px;
}
.query input {
    background: none;
    border: 0;
    outline: none;
    min-width: 0;
    height: 38px;
    font-size: 14.5px;
}
.query :deep(.limit) {
    width: 112px;
    min-height: 36px;
    padding-top: 6px;
    padding-bottom: 6px;
}
@media (max-width: 640px) {
    .query {
        flex-wrap: wrap;
    }
    .query input {
        flex-basis: calc(100% - 40px);
    }
}

.hits {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
}
.hit {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.hit-head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.rank {
    width: 26px;
    font-size: 12px;
}
.kind {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: var(--accent-soft);
    color: var(--accent);
}
.kind.git {
    background: var(--violet-soft);
    color: var(--violet);
}
.kind.faq {
    background: var(--info-soft);
    color: var(--info);
}
.title-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
}
.title-link:hover {
    text-decoration: underline;
}
.score {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
}
.bar {
    width: 96px;
    height: 6px;
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
}
.bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--text-dim);
    transition: width 0.4s var(--ease);
}
.score.high .bar span {
    background: var(--accent);
}
.score.mid .bar span {
    background: var(--warning);
}
.score.high .mono {
    color: var(--accent);
}
.content {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
}
.content.clamped {
    max-height: calc(1.6em * 7 + 20px);
    overflow: hidden;
    mask-image: linear-gradient(#000 65%, transparent);
}
.more {
    align-self: flex-start;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: 12.5px;
}
.more:hover {
    text-decoration: underline;
}
@media (max-width: 640px) {
    .bar {
        width: 56px;
    }
}
</style>
