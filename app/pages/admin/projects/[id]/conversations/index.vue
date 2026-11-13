<script setup lang="ts">
import {MessagesSquare, Search} from "lucide-vue-next"
import type {ChatSession} from "#shared/types"

type SessionRow = Omit<ChatSession, "tokenHash" | "ipHash">

const projectId = useProjectId()
const allowed = await guardProjectPage(projectId.value!, "sessions:read")
useHead({title: "Conversations · RAGPulse"})

const items = ref<SessionRow[]>([])
const nextBefore = ref<string | undefined>()
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const search = ref("")
let requestId = 0

async function load(reset: boolean) {
    const id = ++requestId
    if (reset) loading.value = true
    else loadingMore.value = true
    try {
        const res = await $fetch<{items: SessionRow[]; nextBefore?: string}>(`/api/projects/${projectId.value}/sessions`, {
            query: {limit: 50, q: search.value.trim() || undefined, before: reset ? undefined : nextBefore.value}
        })
        if (id !== requestId) return
        items.value = reset ? res.items : [...items.value, ...res.items]
        nextBefore.value = res.nextBefore
        loaded.value = true
    } catch (err) {
        if (id === requestId) useToast().error(errorMessage(err))
    } finally {
        if (id === requestId) {
            loading.value = false
            loadingMore.value = false
        }
    }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => load(true), 300)
})
onBeforeUnmount(() => clearTimeout(debounce))
if (allowed) onMounted(() => load(true))

function originHost(origin?: string) {
    if (!origin) return "—"
    try {
        return new URL(origin).host
    } catch {
        return origin
    }
}

function open(row: SessionRow) {
    navigateTo(`/admin/projects/${projectId.value}/conversations/${row._id}`)
}
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Conversations</p>
                <h1>Chat sessions</h1>
                <p>Every conversation visitors had with your assistant, newest activity first.</p>
            </div>
            <label class="search control">
                <Search :size="15" class="dim" />
                <span class="sr-only">Search conversations</span>
                <input v-model="search" type="search" placeholder="Search by visitor name or email" class="search-input" />
            </label>
        </header>

        <div v-if="!loaded" class="table-wrap">
            <div v-for="i in 6" :key="i" class="skel-row">
                <div class="skeleton" style="width: 28px; height: 28px; border-radius: 50%" />
                <div class="skeleton grow" style="height: 14px" />
                <div class="skeleton" style="width: 80px; height: 14px" />
            </div>
        </div>

        <UiEmpty
            v-else-if="!items.length"
            :icon="search ? Search : MessagesSquare"
            :title="search ? 'No matching conversations' : 'No conversations yet'"
            :description="search ? `Nothing matches “${search}”.` : 'Once visitors start chatting on your site, their conversations show up here.'"
        >
            <UiButton v-if="search" variant="secondary" @click="search = ''">Clear search</UiButton>
        </UiEmpty>

        <template v-else>
            <div class="table-wrap" :class="{busy: loading}">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Visitor</th>
                            <th class="num hide-sm">Messages</th>
                            <th>Status</th>
                            <th class="hide-sm">Origin</th>
                            <th class="right">Last activity</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in items" :key="s._id" class="clickable" @click="open(s)">
                            <td>
                                <NuxtLink :to="`/admin/projects/${projectId}/conversations/${s._id}`" class="visitor" @click.stop>
                                    <span class="avatar">{{ initials(s.visitorName) }}</span>
                                    <span class="visitor-text">
                                        <span class="truncate strong">{{ s.visitorName || "Visitor" }}</span>
                                        <span class="truncate tiny dim">{{ s.visitorEmail || "No email" }}</span>
                                    </span>
                                </NuxtLink>
                            </td>
                            <td class="num hide-sm">{{ s.messageCount }}</td>
                            <td>
                                <UiBadge v-if="s.unansweredCount" tone="warning">{{ s.unansweredCount }} unanswered</UiBadge>
                                <UiBadge v-else-if="s.finishedAt" tone="success">Finished</UiBadge>
                                <UiBadge v-else-if="s.limitReached" tone="danger">Limit reached</UiBadge>
                                <span v-else class="dim small">—</span>
                            </td>
                            <td class="hide-sm">
                                <span class="small muted truncate origin" :title="s.origin">{{ originHost(s.origin) }}</span>
                            </td>
                            <td class="right nowrap small muted" :title="formatDate(s.lastMessageAt, true)">{{ timeAgo(s.lastMessageAt) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="row" style="justify-content: center; margin-top: 16px">
                <UiButton v-if="nextBefore" variant="secondary" :loading="loadingMore" @click="load(false)">Load more</UiButton>
                <p v-else class="dim small">{{ items.length }} conversation{{ items.length === 1 ? "" : "s" }}</p>
            </div>
        </template>
    </div>
</template>

<style scoped>
.search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: min(320px, 100%);
    padding-top: 0;
    padding-bottom: 0;
}
.search-input {
    flex: 1;
    background: none;
    border: 0;
    outline: none;
    min-width: 0;
    height: 36px;
}
.search-input:focus-visible {
    box-shadow: none;
}
.search:focus-within {
    border-color: var(--accent);
    box-shadow: var(--ring);
}
.skel-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
}
.skel-row:last-child {
    border-bottom: 0;
}
.busy {
    opacity: 0.6;
    transition: opacity 0.15s;
}
.visitor {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 320px;
}
.visitor-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.35;
}
.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 1%;
    white-space: nowrap;
}
.right {
    text-align: right;
}
.origin {
    display: inline-block;
    max-width: 220px;
    vertical-align: middle;
}
@media (max-width: 720px) {
    .hide-sm {
        display: none;
    }
    .search {
        width: 100%;
    }
}
</style>
