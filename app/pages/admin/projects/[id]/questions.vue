<script setup lang="ts">
import {ArrowLeft, BookOpen, Check, CheckCircle2, Inbox, MessageSquareReply, MessagesSquare, RotateCcw, Send, XCircle} from "lucide-vue-next"
import type {AnswerEmailStatus, ChatMessage, Faq, Question, QuestionStatus} from "#shared/types"

type Tab = QuestionStatus | "all"
type Counts = Record<Tab, number>

const route = useRoute()
const router = useRouter()
const projectId = useProjectId()
const allowed = await guardProjectPage(projectId.value!, "questions:reply")
const {can} = useMe()
const {refresh: refreshProjects} = useProjects()
const toast = useToast()
useHead({title: "Escalated questions · RAGPulse"})

const tabs: Array<{id: Tab; label: string}> = [
    {id: "open", label: "Open"},
    {id: "answered", label: "Answered"},
    {id: "dismissed", label: "Dismissed"},
    {id: "all", label: "All"}
]
const tab = ref<Tab>("open")
const items = ref<Question[]>([])
const counts = ref<Counts | null>(null)
const loading = ref(true)
const selectedId = ref<string | undefined>(typeof route.query.q === "string" ? route.query.q : undefined)
const selected = computed(() => items.value.find((q) => q._id === selectedId.value))
let deepLinkPending = !!selectedId.value
let requestId = 0

const base = computed(() => `/api/projects/${projectId.value}/questions`)

async function loadCounts() {
    counts.value = await $fetch<Counts>(`${base.value}/counts`).catch(() => counts.value)
}

async function loadList() {
    const id = ++requestId
    loading.value = true
    try {
        const list = await $fetch<Question[]>(base.value, {query: {status: tab.value}})
        if (id !== requestId) return
        items.value = list
        if (deepLinkPending && selectedId.value && !list.some((q) => q._id === selectedId.value) && tab.value !== "all") {
            tab.value = "all"
            return
        }
        deepLinkPending = false
    } catch (err) {
        toast.error(errorMessage(err))
    } finally {
        if (id === requestId) loading.value = false
    }
}

watch(tab, loadList)
if (allowed) {
    onMounted(() => {
        loadList()
        loadCounts()
    })
}

function select(id?: string) {
    selectedId.value = id
    router.replace({query: {...route.query, q: id}})
}

watch(
    () => route.query.q,
    (q) => {
        const id = typeof q === "string" ? q : undefined
        if (id === selectedId.value) return
        selectedId.value = id
        if (id && !items.value.some((i) => i._id === id)) {
            deepLinkPending = true
            loadList()
        }
    }
)

// ----- Composer -----
const answer = ref("")
/** Human replies posted in the chat after the question: the answer is drafted from them and only recorded */
const chatReplies = ref(0)
const drafting = ref(false)
const setMode = computed(() => chatReplies.value > 0 && selected.value?.status === "open")
let draftRequest = 0

watch(
    () => [selected.value?._id, selected.value?.status],
    async () => {
        answer.value = ""
        chatReplies.value = 0
        const q = selected.value
        const id = ++draftRequest
        drafting.value = false
        if (!q || q.status !== "open") return
        drafting.value = true
        try {
            const res = await $fetch<{humanReplies: number; draft: string}>(`${base.value}/${q._id}/draft`)
            if (id !== draftRequest || !res.humanReplies) return
            chatReplies.value = res.humanReplies
            if (!answer.value.trim()) answer.value = res.draft
        } catch {
            // The answer can still be written by hand
        } finally {
            if (id === draftRequest) drafting.value = false
        }
    },
    {immediate: true}
)

/** Explains where the answer goes: chat, FAQ and (only when the visitor is away) email. */
const composerHint = computed(() => {
    const q = selected.value
    if (!q) return undefined
    const parts: string[] = []
    if (setMode.value) parts.push(`Summarized from ${chatReplies.value} ${chatReplies.value === 1 ? "reply" : "replies"} in the conversation, saved as the answer without posting it to the chat again.`)
    else parts.push("Posted in the visitor's chat.")
    if (!q.faqId && q.status === "open") parts.push("Added to the FAQ.")
    if (q.visitorEmail) parts.push(`Emailed to ${q.visitorEmail} only if they don't see it in the chat.`)
    return parts.join(" ")
})

const {run, pending} = useAction()
const statusAction = useAction()

function replace(q: Question) {
    items.value = items.value.map((i) => (i._id === q._id ? q : i))
}

async function afterChange() {
    await Promise.all([loadCounts(), refreshProjects().catch(() => {})])
}

async function sendReply() {
    const q = selected.value
    const text = answer.value.trim()
    if (!q || !text) return
    const recordOnly = setMode.value
    const res = await run(() =>
        $fetch<{question: Question; message?: ChatMessage; faq?: Faq; email: AnswerEmailStatus}>(`${base.value}/${q._id}/reply`, {
            method: "POST",
            body: {answer: text, postToChat: !recordOnly}
        })
    )
    if (!res) return
    replace(res.question)
    answer.value = ""
    chatReplies.value = 0
    const parts = [recordOnly ? "Answer set" : res.message ? "Reply sent" : "Answer set, not posted: the conversation ended"]
    if (res.faq) parts.push("added to FAQ")
    const emailText = {sent: "visitor emailed", scheduled: "visitor will be emailed unless they open the chat", seen: "visitor is in the chat, no email", failed: "email could not be sent", none: ""}[res.email]
    if (emailText) parts.push(emailText)
    toast.success(parts.join(" · "))
    await afterChange()
}

async function setStatus(status: "open" | "dismissed") {
    const q = selected.value
    if (!q) return
    const res = await statusAction.run(() => $fetch<Question>(`${base.value}/${q._id}`, {method: "PATCH", body: {status}}), status === "dismissed" ? "Question dismissed" : "Question reopened")
    if (!res) return
    replace(res)
    await afterChange()
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        sendReply()
    }
}

const reasonInfo: Record<string, {label: string; tone: "warning" | "danger" | "info"}> = {
    low_confidence: {label: "Low confidence", tone: "warning"},
    rate_limit: {label: "Limit reached", tone: "danger"},
    user_request: {label: "Asked for human", tone: "info"}
}
const statusTone = {open: "warning", answered: "success", dismissed: "neutral"} as const
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Inbox</p>
                <h1>Escalated questions</h1>
                <p>Questions the assistant couldn't answer or that visitors escalated. Your answer appears in their chat, is saved to the FAQ and is emailed when they aren't in the chat.</p>
            </div>
        </header>

        <div class="tabs" role="tablist" aria-label="Question status">
            <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" :class="{on: tab === t.id}" @click="tab = t.id">
                {{ t.label }}
                <span v-if="counts" class="tab-count" :class="{hot: t.id === 'open' && counts.open}">{{ counts[t.id] }}</span>
            </button>
        </div>

        <div class="inbox" :class="{'has-selection': !!selected}">
            <section class="panel list" aria-label="Questions">
                <div v-if="loading && !items.length" class="stack" style="padding: 12px">
                    <div v-for="i in 5" :key="i" class="skeleton" style="height: 58px" />
                </div>
                <div v-else-if="!items.length" class="list-empty">
                    <Inbox :size="22" class="accent" />
                    <p class="strong">{{ tab === "open" ? "Inbox zero" : "Nothing here" }}</p>
                    <p class="muted small">{{ tab === "open" ? "No open questions. Nice work!" : "No questions with this status." }}</p>
                </div>
                <ul v-else class="items" :class="{busy: loading}">
                    <li v-for="q in items" :key="q._id">
                        <button type="button" class="item" :class="{active: q._id === selectedId}" @click="select(q._id)">
                            <span class="row between" style="--gap: 8px">
                                <span class="row truncate" style="--gap: 6px">
                                    <span class="dot" :class="q.status === 'open' ? 'warn' : q.status === 'answered' ? 'ok' : ''" />
                                    <span class="small strong truncate">{{ q.visitorName || "Visitor" }}</span>
                                </span>
                                <span class="tiny dim nowrap">{{ timeAgo(q.createdAt) }}</span>
                            </span>
                            <span class="clamp small muted">{{ q.question }}</span>
                        </button>
                    </li>
                </ul>
            </section>

            <section class="panel detail" aria-live="polite">
                <div v-if="!selected" class="detail-empty">
                    <MessageSquareReply :size="22" class="dim" />
                    <p class="muted">Select a question to reply.</p>
                </div>

                <template v-else>
                    <header class="detail-head">
                        <button type="button" class="back-btn small muted" @click="select(undefined)"><ArrowLeft :size="14" /> All questions</button>
                        <div class="row wrap" style="--gap: 6px">
                            <UiBadge :tone="statusTone[selected.status]">{{ selected.status }}</UiBadge>
                            <UiBadge :tone="reasonInfo[selected.reason]?.tone">{{ reasonInfo[selected.reason]?.label }}</UiBadge>
                            <span class="tiny dim">{{ formatDate(selected.createdAt, true) }}</span>
                        </div>
                        <div class="row wrap" style="--gap: 6px">
                            <UiButton v-if="can(projectId, 'sessions:read')" size="sm" variant="ghost" :to="`/admin/projects/${projectId}/conversations/${selected.sessionId}`"> <MessagesSquare :size="14" /> Conversation </UiButton>
                            <UiButton v-if="selected.status === 'open'" size="sm" variant="ghost" :loading="statusAction.pending.value" @click="setStatus('dismissed')"> <XCircle :size="14" /> Dismiss </UiButton>
                            <UiButton v-else-if="selected.status === 'dismissed'" size="sm" variant="ghost" :loading="statusAction.pending.value" @click="setStatus('open')"> <RotateCcw :size="14" /> Reopen </UiButton>
                        </div>
                    </header>

                    <div class="detail-body">
                        <div class="visitor row" style="--gap: 10px">
                            <span class="avatar">{{ initials(selected.visitorName) }}</span>
                            <div class="grow">
                                <p class="strong truncate">{{ selected.visitorName || "Visitor" }}</p>
                                <p class="tiny dim truncate">
                                    <a v-if="selected.visitorEmail" :href="`mailto:${selected.visitorEmail}`" class="email">{{ selected.visitorEmail }}</a>
                                    <template v-else>No email left</template>
                                </p>
                            </div>
                        </div>

                        <blockquote class="question pre-wrap">{{ selected.question }}</blockquote>

                        <div v-if="selected.answer" class="answer">
                            <p class="tiny dim row" style="--gap: 6px">
                                <CheckCircle2 :size="13" class="accent" />
                                Answered by {{ selected.answeredBy?.name || "Team" }}{{ selected.answeredBy?.via === "mcp" ? " (bot)" : "" }} · {{ timeAgo(selected.answeredAt) }}
                                <template v-if="selected.visitorNotifiedAt"> · emailed</template>
                                <span v-else-if="selected.visitorEmailDueAt" :title="`Emailed at ${formatDate(selected.visitorEmailDueAt, true)} unless the visitor opens the chat`"> · email pending</span>
                            </p>
                            <AdminMarkdownContent :content="selected.answer" />
                            <p v-if="selected.faqId" class="tiny faq-ref row" style="--gap: 6px">
                                <BookOpen :size="13" />
                                <NuxtLink v-if="can(projectId, 'sources:manage')" :to="`/admin/projects/${projectId}/knowledge?tab=faq&faq=${selected.faqId}`" class="link">Added to the FAQ: view or delete</NuxtLink>
                                <span v-else>Added to the FAQ</span>
                            </p>
                        </div>

                        <p v-if="selected.status === 'dismissed'" class="muted small">This question was dismissed. Reopen it to reply.</p>
                    </div>

                    <form v-if="selected.status !== 'dismissed'" class="composer" @submit.prevent="sendReply">
                        <UiTextarea
                            v-model="answer"
                            :label="selected.status === 'answered' ? 'Send a follow-up' : 'Your answer'"
                            :rows="5"
                            maxlength="8000"
                            :placeholder="drafting ? 'Summarizing the replies from the chat…' : 'Write a helpful answer… Markdown is supported.'"
                            :hint="composerHint"
                            @keydown="onKeydown"
                        />
                        <div class="row end">
                            <UiButton type="submit" variant="primary" :loading="pending" :disabled="!answer.trim()">
                                <template v-if="setMode"><Check :size="14" /> Set answer</template>
                                <template v-else><Send :size="14" /> Send answer</template>
                            </UiButton>
                        </div>
                    </form>
                </template>
            </section>
        </div>
    </div>
</template>

<style scoped>
.tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
}
.tabs button {
    background: none;
    border: 0;
    padding: 8px 12px 10px;
    color: var(--text-muted);
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
}
.tabs button:hover {
    color: var(--text);
}
.tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
}
.tab-count {
    font-size: 11px;
    padding: 0 7px;
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
}
.tab-count.hot {
    background: var(--warning-soft);
    color: var(--warning);
}

.inbox {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
}
.list {
    overflow: hidden;
    position: sticky;
    top: 16px;
}
.items {
    list-style: none;
    margin: 0;
    padding: 6px;
    max-height: calc(100dvh - 260px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.items.busy {
    opacity: 0.6;
}
.item {
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.item:hover {
    background: var(--surface-2);
}
.item.active {
    background: var(--surface-2);
    border-color: var(--border-strong);
}
.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.list-empty,
.detail-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 48px 20px;
    text-align: center;
}
.detail {
    overflow: hidden;
    min-height: 360px;
}
.detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
}
.back-btn {
    display: none;
    background: none;
    border: 0;
    padding: 0;
    align-items: center;
    gap: 6px;
}
.detail-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.email {
    color: var(--accent);
}
.question {
    margin: 0;
    padding: 14px 16px;
    border-left: 3px solid var(--warning);
    background: var(--bg-elev);
    border-radius: 0 var(--radius) var(--radius) 0;
    font-size: 15px;
    line-height: 1.55;
}
.answer {
    padding: 14px 16px;
    border-radius: var(--radius);
    background: var(--violet-soft);
    border: 1px solid rgb(157 140 255 / 0.25);
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.faq-ref {
    color: var(--text-muted);
    padding-top: 8px;
    border-top: 1px solid rgb(157 140 255 / 0.2);
}
.link {
    color: var(--accent);
}
.composer {
    border-top: 1px solid var(--border);
    padding: 16px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bg-elev);
}
@media (max-width: 900px) {
    .inbox {
        grid-template-columns: minmax(0, 1fr);
    }
    .list {
        position: static;
    }
    .items {
        max-height: none;
    }
    .inbox.has-selection .list {
        display: none;
    }
    .inbox:not(.has-selection) .detail {
        display: none;
    }
    .back-btn {
        display: inline-flex;
        width: 100%;
    }
}
</style>
