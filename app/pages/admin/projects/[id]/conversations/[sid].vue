<script setup lang="ts">
import {AlertTriangle, ArrowLeft, Bot, Check, CircleCheck, FileText, Headset, LogOut, Send, UserRound} from "lucide-vue-next"
import type {ChatMessage, ChatSession, Question} from "#shared/types"

interface Detail {
    session: Omit<ChatSession, "tokenHash" | "ipHash">
    messages: ChatMessage[]
    questions: Question[]
    canGiveBack: boolean
}

const route = useRoute()
const projectId = useProjectId()
const sid = computed(() => String(route.params.sid))
const allowed = await guardProjectPage(projectId.value!, "sessions:read")
const {can} = useMe()
const {refreshOpenQuestions} = useProjects()
const canReply = computed(() => can(projectId.value, "questions:reply"))
const modifierKey = useModifierKey()

const {data, error, status, refresh} = useFetch<Detail>(() => `/api/projects/${projectId.value}/sessions/${sid.value}`, {
    lazy: true,
    immediate: allowed,
    server: false
})

useHead({title: () => `${data.value?.session.visitorName || "Conversation"} · RAGPulse`})

const reply = ref("")
const {run, pending} = useAction()
const {run: runGiveBack, pending: giveBackPending} = useAction()
const thread = ref<HTMLElement>()

/**
 * Ends the human takeover: the assistant answers the visitor again. An ended conversation is only marked as finished.
 * Either way a FAQ is learned from the human replies in the background (replies already saved as an answer are skipped).
 */
async function giveBack(done?: string) {
    if (!data.value) return
    done ??= data.value.session.endedAt ? "Conversation finished: a FAQ is learned from your replies" : "Given back to the agent: the assistant answers the visitor again"
    const res = await runGiveBack(() => $fetch<{session: Detail["session"]}>(`/api/projects/${projectId.value}/sessions/${sid.value}`, {method: "PATCH", body: {finished: true}}), done)
    // Reload instead of trusting the response: a reply sent meanwhile may have taken the conversation over again
    if (res) await refresh()
    return !!res
}

// ----- Give back with answers -----
/** One answer per open question, drafted from the replies posted in the chat after it */
interface AnswerDraft {
    question: Question
    answer: string
    replies: number
    loading: boolean
    saved: boolean
}
const answerDialog = ref(false)
const drafts = ref<AnswerDraft[]>([])
const draftsLoading = computed(() => drafts.value.some((d) => d.loading))
const {run: runAnswers, pending: answersPending} = useAction()
let draftRequest = 0

/**
 * Opens the dialog asking whether to also answer the open questions. Each answer is pre-filled with the draft of the
 * Escalated view: a single reply as is, several replies composed by the AI. Without open questions the chat is given back right away.
 */
function startGiveBack() {
    if (!data.value?.canGiveBack) return
    const open = data.value.questions.filter((q) => q.status === "open")
    if (!open.length) return giveBack()
    const id = ++draftRequest
    drafts.value = open.map((question) => ({question, answer: "", replies: 0, loading: true, saved: false}))
    answerDialog.value = true
    for (const draft of drafts.value) {
        $fetch<{humanReplies: number; draft: string}>(`/api/projects/${projectId.value}/questions/${draft.question._id}/draft`)
            .then((res) => {
                if (id !== draftRequest) return
                draft.replies = res.humanReplies
                if (!draft.answer.trim()) draft.answer = res.draft
            })
            .catch(() => {
                // The answer can still be written by hand
            })
            .finally(() => {
                if (id === draftRequest) draft.loading = false
            })
    }
}

/** Saves each filled-in answer the way the Escalated view does (an empty one keeps its question open), then gives the chat back. */
async function saveAnswersAndGiveBack() {
    const todo = drafts.value.filter((d) => !d.saved && d.answer.trim())
    const saved = await runAnswers(async () => {
        for (const draft of todo) {
            // An answer drafted from team replies was already read in the chat, so it is only recorded (FAQ, email when away); one written here is posted
            await $fetch(`/api/projects/${projectId.value}/questions/${draft.question._id}/reply`, {method: "POST", body: {answer: draft.answer.trim(), postToChat: !draft.replies}})
            draft.saved = true
        }
        return true
    })
    refreshOpenQuestions(projectId.value!).catch(() => {})
    if (!saved) return refresh()
    const answered = drafts.value.filter((d) => d.saved).length
    answerDialog.value = false
    await giveBack(`${answered === 1 ? "Answer saved" : `${answered} answers saved`} and given back to the agent`)
}

/** "No": only gives the chat back, the questions stay open. */
async function giveBackOnly() {
    answerDialog.value = false
    await giveBack()
}

/** Where the pre-filled answer comes from. */
function draftHint(d: AnswerDraft): string {
    const keepOpen = drafts.value.length > 1 ? " Leave it empty to keep this question open." : ""
    if (!d.replies) return `No reply to this question in the chat yet: the answer you write here is posted in the visitor's chat.${keepOpen}`
    if (d.replies === 1) return `Your reply from the chat. Edit it before saving if needed.${keepOpen}`
    return `Composed from your ${d.replies} replies in the chat. Review it before saving.${keepOpen}`
}

watch(answerDialog, (open) => {
    if (!open) draftRequest++
})

async function send() {
    const content = reply.value.trim()
    if (!content || !data.value) return
    const message = await run(
        () =>
            $fetch<ChatMessage>(`/api/projects/${projectId.value}/sessions/${sid.value}/messages`, {
                method: "POST",
                body: {content}
            }),
        "Reply sent"
    )
    if (!message) return
    reply.value = ""
    // Reload: the reply reopens a finished conversation and may hand it over to a human
    await refresh()
    nextTick(() => thread.value?.lastElementChild?.scrollIntoView({behavior: "smooth", block: "end"}))
}

// Picks up new visitor messages while the page is open (live back-and-forth with the visitor)
const POLL_MS = 10_000
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    poll = setInterval(async () => {
        if (document.visibilityState !== "visible" || !data.value || status.value === "pending" || pending.value || giveBackPending.value || answersPending.value) return
        const current = data.value
        const fresh = await $fetch<Detail>(`/api/projects/${projectId.value}/sessions/${sid.value}`).catch(() => null)
        // A refresh or local action during the fetch has newer data: the stale poll result is discarded
        if (fresh && fresh.session._id === sid.value && data.value === current) data.value = fresh
    }, POLL_MS)
})
onBeforeUnmount(() => clearInterval(poll))

const endedText = computed(() => (data.value?.session.endReason === "inactive" ? "Closed after a period without messages" : "The visitor started a new conversation"))

const openQuestion = computed(() => data.value?.questions.find((q) => q.status === "open"))

function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        send()
    }
}

const statusTone = {open: "warning", answered: "success", dismissed: "neutral"} as const
const reasonLabel: Record<string, string> = {low_confidence: "Low confidence", rate_limit: "Limit reached", user_request: "Asked for human"}

function time(value: string | Date) {
    return new Date(value).toLocaleString("en", {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"})
}

function hostOf(url?: string) {
    if (!url) return ""
    try {
        return new URL(url).host
    } catch {
        return url
    }
}

/** Shows a day separator when the date changes between messages. */
function dayLabel(i: number): string | null {
    const list = data.value?.messages ?? []
    const cur = new Date(list[i]!.createdAt)
    const prev = i > 0 ? new Date(list[i - 1]!.createdAt) : null
    if (prev && prev.toDateString() === cur.toDateString()) return null
    return cur.toLocaleDateString("en", {weekday: "short", month: "short", day: "numeric", year: "numeric"})
}
</script>

<template>
    <div class="page">
        <NuxtLink :to="`/admin/projects/${projectId}/conversations`" class="back small muted"><ArrowLeft :size="14" /> Conversations</NuxtLink>

        <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

        <div v-else-if="!data" class="layout">
            <div class="panel panel-pad stack"><div v-for="i in 5" :key="i" class="skeleton" :style="{height: '54px', width: i % 2 ? '70%' : '55%', alignSelf: i % 2 ? 'flex-start' : 'flex-end'}" /></div>
            <div class="panel panel-pad stack"><div v-for="i in 6" :key="i" class="skeleton" style="height: 14px" /></div>
        </div>

        <div v-else class="layout" :class="{busy: status === 'pending'}">
            <section class="panel convo">
                <header class="convo-head">
                    <span class="avatar lg">{{ initials(data.session.visitorName) }}</span>
                    <div class="grow">
                        <h1 class="truncate">{{ data.session.visitorName || "Visitor" }}</h1>
                        <p class="dim small">{{ data.session.messageCount }} messages · started {{ timeAgo(data.session.createdAt) }}</p>
                    </div>
                    <UiBadge v-if="data.session.unansweredCount" tone="warning">{{ data.session.unansweredCount }} unanswered</UiBadge>
                    <UiBadge v-if="data.session.humanHandledAt" tone="info"><UserRound :size="12" /> Human handling</UiBadge>
                    <UiBadge v-if="data.session.endedAt" tone="neutral" :title="endedText"><LogOut :size="12" /> Ended</UiBadge>
                    <UiBadge v-if="data.session.finishedAt && data.session.endedAt" tone="success"><CircleCheck :size="12" /> Finished</UiBadge>
                    <UiBadge v-else-if="data.session.finishedAt" tone="success" :title="`Given back to the agent ${timeAgo(data.session.finishedAt)}`"><CircleCheck :size="12" /> With agent</UiBadge>
                    <UiButton v-else-if="canReply && data.session.endedAt" size="sm" :loading="giveBackPending" title="Flag as finished and learn a FAQ from your replies" @click="giveBack()"><CircleCheck :size="14" /> Mark finished</UiButton>
                </header>

                <div ref="thread" class="thread">
                    <p v-if="!data.messages.length" class="muted small empty-thread">No messages in this conversation.</p>
                    <template v-for="(m, i) in data.messages" :key="m._id">
                        <p v-if="dayLabel(i)" class="day tiny dim">{{ dayLabel(i) }}</p>
                        <div class="msg" :class="m.role">
                            <div class="meta tiny dim">
                                <template v-if="m.role === 'user'">{{ data.session.visitorName || "Visitor" }}</template>
                                <template v-else-if="m.role === 'assistant'"><Bot :size="12" /> Assistant</template>
                                <template v-else><Headset :size="12" /> {{ m.author?.via === "mcp" ? "Bot" : "Support" }} · {{ m.author?.name || "Team" }}</template>
                                <span>· {{ time(m.createdAt) }}</span>
                                <span v-if="m.latencyMs" :title="m.model">· {{ (m.latencyMs / 1000).toFixed(1) }}s</span>
                            </div>
                            <div class="bubble">
                                <p v-if="m.role === 'user'" class="pre-wrap">{{ m.content }}</p>
                                <AdminMarkdownContent v-else :content="m.content" />
                            </div>
                            <div v-if="m.sources?.length" class="chips">
                                <component :is="s.url ? 'a' : 'span'" v-for="(s, si) in m.sources" :key="si" class="chip" :href="s.url" target="_blank" rel="noopener" :title="s.url || s.title">
                                    <FileText :size="11" /> <span class="truncate">{{ s.title || hostOf(s.url) }}</span>
                                </component>
                            </div>
                            <p v-if="m.escalated" class="escalated tiny"><AlertTriangle :size="12" /> Escalated to support</p>
                        </div>
                    </template>
                </div>

                <p v-if="data.session.humanHandledAt && !data.session.endedAt" class="handoff small">
                    <UserRound :size="14" />
                    <span
                        >Handled by {{ data.session.humanHandledBy?.name || "a human" }}: the assistant won't reply until the question is answered or you give the chat back to the agent.
                        <NuxtLink v-if="openQuestion && canReply" :to="`/admin/projects/${projectId}/questions?q=${openQuestion._id}`" class="link">Set the answer</NuxtLink></span
                    >
                </p>
                <p v-if="data.session.endedAt" class="ended small muted">
                    <LogOut :size="14" />
                    <span>
                        {{ endedText }} {{ timeAgo(data.session.endedAt) }}: it can't receive new messages.
                        <template v-if="openQuestion">
                            An escalated question still has no answer.
                            <NuxtLink v-if="canReply" :to="`/admin/projects/${projectId}/questions?q=${openQuestion._id}`" class="link">Set the answer</NuxtLink>
                        </template>
                    </span>
                </p>
                <form v-else-if="canReply" class="composer" @submit.prevent="send">
                    <label class="sr-only" for="reply">Reply as support</label>
                    <textarea id="reply" v-model="reply" class="control" rows="3" maxlength="8000" placeholder="Reply to the visitor as a human agent… (Markdown supported)" @keydown="onKeydown" />
                    <div class="composer-foot">
                        <span class="tiny dim">
                            Shown in the visitor's chat. <span class="kbd">{{ modifierKey }}</span> + <span class="kbd">Enter</span> to send
                        </span>
                        <div class="composer-actions">
                            <UiButton
                                v-if="!data.session.finishedAt"
                                size="sm"
                                :loading="giveBackPending"
                                :disabled="!data.canGiveBack"
                                :title="data.canGiveBack ? 'End the human takeover: the assistant answers the visitor again, and a FAQ is learned from your replies' : 'Available after a human replies and takes over'"
                                @click="startGiveBack"
                            >
                                <Bot :size="14" /> Give back to agent
                            </UiButton>
                            <UiButton type="submit" variant="primary" size="sm" :loading="pending" :disabled="!reply.trim()"><Send :size="14" /> Send reply</UiButton>
                        </div>
                    </div>
                </form>
            </section>

            <aside class="side stack" style="--gap: 16px">
                <UiCard title="Visitor">
                    <dl class="facts">
                        <dt>Name</dt>
                        <dd>{{ data.session.visitorName || "—" }}</dd>
                        <dt>Email</dt>
                        <dd>
                            <a v-if="data.session.visitorEmail" :href="`mailto:${data.session.visitorEmail}`" class="link">{{ data.session.visitorEmail }}</a>
                            <span v-else class="dim">Not provided</span>
                        </dd>
                        <dt>Origin</dt>
                        <dd class="break">{{ data.session.origin || "—" }}</dd>
                        <dt>Started</dt>
                        <dd>{{ formatDate(data.session.createdAt, true) }}</dd>
                        <dt>Last activity</dt>
                        <dd>{{ formatDate(data.session.lastMessageAt, true) }}</dd>
                        <dt>Messages</dt>
                        <dd>
                            {{ data.session.messageCount }} <span class="dim">({{ data.session.userMessageCount }} from visitor)</span>
                        </dd>
                        <template v-if="data.session.limitReached"
                            ><dt>Limit</dt>
                            <dd><UiBadge tone="danger">Message limit reached</UiBadge></dd></template
                        >
                        <template v-if="data.session.endedAt"
                            ><dt>Ended</dt>
                            <dd>{{ formatDate(data.session.endedAt, true) }} {{ data.session.endReason === "inactive" ? "(inactive)" : "by the visitor" }}</dd></template
                        >
                        <template v-if="data.session.finishedAt"
                            ><dt>{{ data.session.endedAt ? "Finished" : "Given back" }}</dt>
                            <dd>
                                {{ formatDate(data.session.finishedAt, true) }}<template v-if="data.session.finishedBy"> by {{ data.session.finishedBy.name }}</template>
                            </dd></template
                        >
                        <template v-if="data.session.learnedFaqId"
                            ><dt>Learned</dt>
                            <dd><NuxtLink :to="`/admin/projects/${projectId}/knowledge?tab=faq`" class="link">FAQ entry</NuxtLink></dd></template
                        >
                        <dt>User agent</dt>
                        <dd class="tiny muted break">{{ data.session.userAgent || "—" }}</dd>
                    </dl>
                </UiCard>

                <UiCard title="Questions" :description="data.questions.length ? 'Escalated from this conversation' : undefined">
                    <p v-if="!data.questions.length" class="muted small">No questions were escalated.</p>
                    <ul v-else class="qlist">
                        <li v-for="q in data.questions" :key="q._id">
                            <NuxtLink v-if="canReply" :to="`/admin/projects/${projectId}/questions?q=${q._id}`" class="q">
                                <p class="small clamp">{{ q.question }}</p>
                                <p class="row" style="--gap: 6px">
                                    <UiBadge :tone="statusTone[q.status]">{{ q.status }}</UiBadge><span class="tiny dim">{{ reasonLabel[q.reason] }}</span>
                                </p>
                            </NuxtLink>
                            <div v-else class="q">
                                <p class="small clamp">{{ q.question }}</p>
                                <p class="row" style="--gap: 6px">
                                    <UiBadge :tone="statusTone[q.status]">{{ q.status }}</UiBadge><span class="tiny dim">{{ reasonLabel[q.reason] }}</span>
                                </p>
                            </div>
                        </li>
                    </ul>
                </UiCard>
            </aside>
        </div>

        <UiModal
            v-model:open="answerDialog"
            title="Give back to agent"
            :description="`The assistant answers the visitor again. Also save your ${drafts.length === 1 ? 'answer to the escalated question? It is' : 'answers to the escalated questions? They are'} added to the FAQ and emailed if the visitor isn't in the chat.`"
            width="600px"
        >
            <div class="stack" style="--gap: 18px">
                <div v-for="(d, i) in drafts" :key="d.question._id" class="stack" style="--gap: 8px">
                    <blockquote class="draft-question small pre-wrap">{{ d.question.question }}</blockquote>
                    <p v-if="d.saved" class="tiny row draft-saved" style="--gap: 6px"><CircleCheck :size="13" /> Answer saved</p>
                    <UiTextarea
                        v-else
                        v-model="d.answer"
                        :label="drafts.length > 1 ? `Answer ${i + 1}` : 'Answer'"
                        :rows="5"
                        maxlength="8000"
                        :placeholder="d.loading ? 'Composing the answer from your replies…' : 'Write the answer… Markdown is supported.'"
                        :hint="d.loading ? undefined : draftHint(d)"
                    >
                        <template v-if="d.loading" #aside
                            ><span class="tiny dim row" style="--gap: 6px"><UiSpinner :size="12" /> Composing…</span></template
                        >
                    </UiTextarea>
                </div>
            </div>
            <template #footer>
                <UiButton variant="ghost" :disabled="answersPending" @click="giveBackOnly">No, just give back</UiButton>
                <UiButton variant="primary" :loading="answersPending" :disabled="draftsLoading || !drafts.some((d) => !d.saved && d.answer.trim())" @click="saveAnswersAndGiveBack">
                    <Check :size="14" /> {{ drafts.length === 1 ? "Save answer" : "Save answers" }} and give back
                </UiButton>
            </template>
        </UiModal>
    </div>
</template>

<style scoped>
.back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 16px;
}
.back:hover {
    color: var(--text);
}
.layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
    align-items: start;
}
.busy {
    opacity: 0.7;
}
.convo {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.convo-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
}
.convo-head h1 {
    font-size: 17px;
}
.avatar.lg {
    width: 36px;
    height: 36px;
    font-size: 13px;
}
.thread {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    min-height: 240px;
}
.empty-thread {
    text-align: center;
    padding: 40px 0;
}
.day {
    align-self: center;
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    background: var(--bg-elev);
}
.msg {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-width: min(78%, 640px);
}
.msg.user {
    align-self: flex-end;
    align-items: flex-end;
}
.meta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.bubble {
    padding: 10px 14px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    word-break: break-word;
}
.msg.user .bubble {
    background: var(--accent-soft);
    border-color: rgb(163 255 122 / 0.2);
    border-bottom-right-radius: 4px;
}
.msg.assistant .bubble {
    border-bottom-left-radius: 4px;
}
.msg.agent .bubble {
    background: var(--violet-soft);
    border-color: rgb(157 140 255 / 0.3);
    border-bottom-left-radius: 4px;
}
.msg.agent .meta {
    color: var(--violet);
}
.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 240px;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 11.5px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    color: var(--text-muted);
}
a.chip:hover {
    color: var(--accent);
    border-color: var(--border-strong);
}
.escalated {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--warning);
}
.handoff {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 10px 20px;
    border-top: 1px solid var(--border);
    background: var(--info-soft);
    color: var(--text-muted);
}
.handoff svg {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--info);
}
.ended {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 14px 20px;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
}
.ended svg {
    flex-shrink: 0;
    margin-top: 2px;
}
.composer {
    border-top: 1px solid var(--border);
    padding: 14px 20px 16px;
    background: var(--bg-elev);
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.composer textarea {
    min-height: 72px;
}
.composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
}
.composer-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
}
.draft-question {
    margin: 0;
    padding: 10px 14px;
    border-left: 3px solid var(--warning);
    background: var(--surface-2);
    border-radius: 0 var(--radius) var(--radius) 0;
}
.draft-saved {
    color: var(--success);
}
.facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px 14px;
    margin: 0;
    font-size: 13px;
}
.facts dt {
    color: var(--text-dim);
}
.facts dd {
    margin: 0;
    min-width: 0;
}
.break {
    word-break: break-all;
}
.link {
    color: var(--accent);
}
.qlist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.q {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    margin: 0 -10px;
    border-radius: 8px;
}
a.q:hover {
    background: var(--surface-2);
}
.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
@media (max-width: 1000px) {
    .layout {
        grid-template-columns: minmax(0, 1fr);
    }
    .msg {
        max-width: 90%;
    }
}
</style>
