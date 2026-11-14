<script setup lang="ts">
import {RotateCcw, X} from "lucide-vue-next"
import type {ChatTheme} from "#shared/types"
import {DEFAULT_THEME} from "#shared/types"

definePageMeta({layout: "blank"})

interface ChatConfig {
    projectId: string
    title: string
    website: string
    theme: ChatTheme
    icon?: string
    rateLimit: number
    hasSupport: boolean
}
interface PublicSession {
    _id: string
    visitorName: string
    visitorEmail?: string
    userMessageCount: number
    limitReached: boolean
    humanHandling?: boolean
}
interface Stored {
    sessionId: string
    token: string
    name: string
    email?: string
}

const MAX_CHARS = 2000
const POLL_MS = 15_000

const route = useRoute()
const projectId = String(route.params.projectId || "")
const preview = route.query.preview === "1"
const embed = route.query.embed === "1"
const parentParam = typeof route.query.parent === "string" ? route.query.parent : ""
const api = `/api/chat/${encodeURIComponent(projectId)}`
// Origin of the admin app, which embeds this page for the appearance preview
const adminOrigin = urlOrigin(publicBaseUrl("admin"))

const {data: config} = await useFetch<ChatConfig>(`${api}/config`, {key: `chat-config-${projectId}`})
if (!config.value && !preview) throw createError({statusCode: 404, statusMessage: "Chat not found", fatal: true})

// ---------- Theme ----------
const themeOverride = ref<Partial<ChatTheme> | null>(null)
const titleOverride = ref("")
const theme = computed(() => resolveChatTheme({...config.value?.theme, ...themeOverride.value}))
const vars = computed(() => chatThemeVars(theme.value))
const title = computed(() => titleOverride.value || config.value?.title || "Chat")
const botName = computed(() => theme.value.botName || title.value)
const botInitial = computed(() => (botName.value.trim()[0] || "A").toUpperCase())
const botIcon = computed(() => config.value?.icon)

useHead({
    title: computed(() => `${botName.value} · ${title.value}`),
    htmlAttrs: {style: computed(() => `color-scheme:${theme.value.mode};background:${vars.value["--c-bg"]}`)},
    bodyAttrs: {style: computed(() => `background:${vars.value["--c-bg"]}`)},
    meta: [
        {name: "robots", content: "noindex"},
        {name: "theme-color", content: computed(() => vars.value["--c-bg"])}
    ]
})

// ---------- State ----------
const phase = ref<"loading" | "intro" | "chat">("loading")
const session = ref<PublicSession | null>(null)
const stored = ref<Stored | null>(null)
const messages = ref<ChatUiMessage[]>([])
const draft = ref("")
const streaming = ref(false)
const banner = ref("")
const introPending = ref(false)
const introError = ref("")
const limit = ref<{message: string; hasSupport: boolean; question?: string; sent?: boolean} | null>(null)
const limitPending = ref(false)
const limitError = ref("")
const escalation = ref<{messageId: string; doneEmail?: string} | null>(null)
const emailPending = ref(false)
const emailError = ref("")
const composer = ref<{focus: () => void} | null>(null)
const scroller = ref<HTMLElement | null>(null)
let localId = 0
let bannerTimer: ReturnType<typeof setTimeout> | undefined

const welcome = computed<ChatUiMessage>(() => ({_id: "welcome", role: "assistant", content: theme.value.welcomeMessage || DEFAULT_THEME.welcomeMessage}))
const remaining = computed(() => {
    const max = config.value?.rateLimit || 0
    if (!max || !session.value) return null
    return Math.max(0, max - session.value.userMessageCount)
})
// A team member is replying: the assistant (and its message limit) is paused
const humanHandling = computed(() => !!session.value?.humanHandling)
const showLimit = computed(() => !!limit.value && !humanHandling.value)
const composerHint = computed(() => {
    if (humanHandling.value) return "A team member is replying to you here"
    return remaining.value !== null && remaining.value <= 3 && !limit.value ? `${remaining.value} message${remaining.value === 1 ? "" : "s"} left in this conversation` : ""
})

function showBanner(text: string) {
    banner.value = text
    clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => (banner.value = ""), 7000)
}

function errorText(err: any, fallback = "Something went wrong, please try again."): string {
    return err?.data?.statusMessage || err?.data?.message || err?.statusMessage || fallback
}

// ---------- Storage (may be unavailable in third-party iframes) ----------
const storageKey = `ragpulse:${projectId}`
let memoryStore: string | null = null
function readStored(): Stored | null {
    let raw: string | null = memoryStore
    try {
        raw = localStorage.getItem(storageKey)
    } catch {}
    try {
        const value = raw ? JSON.parse(raw) : null
        return value?.sessionId && value?.token ? value : null
    } catch {
        return null
    }
}
function writeStored(value: Stored | null) {
    memoryStore = value ? JSON.stringify(value) : null
    try {
        if (value) localStorage.setItem(storageKey, memoryStore!)
        else localStorage.removeItem(storageKey)
    } catch {}
}

// ---------- Scrolling ----------
const stick = ref(true)
function onScroll() {
    const el = scroller.value
    if (el) stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 90
}
function scrollToBottom(force = false) {
    nextTick(() => {
        const el = scroller.value
        if (el && (force || stick.value)) el.scrollTop = el.scrollHeight
    })
}
watch(
    () => [messages.value.length, messages.value[messages.value.length - 1]?.content, limit.value, escalation.value, phase.value],
    () => scrollToBottom()
)

// ---------- Session ----------
function applyServer(list: ChatUiMessage[], s: PublicSession) {
    session.value = s
    if (stored.value && s.visitorEmail && stored.value.email !== s.visitorEmail) {
        stored.value = {...stored.value, email: s.visitorEmail}
        writeStored(stored.value)
    }
    if (!streaming.value && list.map((m) => m._id).join() !== messages.value.map((m) => m._id).join()) {
        messages.value = list
    }
    if (s.limitReached && !limit.value) {
        limit.value = {message: "You've reached the message limit for this conversation. Send your question to our team and we'll get back to you.", hasSupport: !!config.value?.hasSupport}
    }
    const lastEscalated = [...messages.value].reverse().find((m) => m.escalated)
    if (lastEscalated && !s.visitorEmail && escalation.value?.messageId !== lastEscalated._id) {
        escalation.value = {messageId: lastEscalated._id}
    }
}

// The embed widget keeps its iframe loaded while closed and reports open / closed (ragpulse:visibility)
const panelOpen = ref(true)
/** Whether the visitor can see the chat: decides if team answers are also emailed to them. */
function chatVisible() {
    return document.visibilityState === "visible" && panelOpen.value
}

let lastPoll = 0
async function loadSession(silent = false) {
    const st = stored.value
    if (!st || streaming.value) return
    lastPoll = Date.now()
    try {
        const res = await $fetch<{session: PublicSession; messages: ChatUiMessage[]}>(`${api}/sessions/${st.sessionId}`, {
            headers: {"x-session-token": st.token},
            query: chatVisible() ? {visible: 1} : undefined
        })
        applyServer(res.messages, res.session)
        phase.value = "chat"
    } catch (err: any) {
        const status = err?.statusCode || err?.response?.status
        if (status === 401 || status === 404) {
            resetConversation()
            return
        }
        if (!silent) {
            phase.value = "chat"
            showBanner("Could not load the conversation. Check your connection.")
        }
    }
}

function parentOrigin(): string {
    if (parentParam) return parentParam
    try {
        if (window.self !== window.top && document.referrer) return new URL(document.referrer).origin
    } catch {}
    return ""
}

async function startSession(payload: {name: string; email?: string}) {
    introPending.value = true
    introError.value = ""
    try {
        const res = await $fetch<{sessionId: string; token: string; session: PublicSession}>(`${api}/sessions`, {
            method: "POST",
            body: {name: payload.name, email: payload.email || "", parentOrigin: parentOrigin() || undefined}
        })
        stored.value = {sessionId: res.sessionId, token: res.token, name: payload.name, email: payload.email}
        writeStored(stored.value)
        session.value = res.session
        messages.value = []
        phase.value = "chat"
        nextTick(() => composer.value?.focus())
    } catch (err) {
        introError.value = errorText(err)
    } finally {
        introPending.value = false
    }
}

function resetConversation() {
    const prev = stored.value
    writeStored(null)
    stored.value = prev ? {...prev, sessionId: "", token: ""} : null
    session.value = null
    messages.value = []
    limit.value = null
    escalation.value = null
    draft.value = ""
    phase.value = "intro"
}

function newConversation() {
    if (streaming.value) return
    // Ends the current conversation on the server so the team can't post into it anymore
    const st = stored.value
    if (st?.sessionId && st.token) $fetch(`${api}/sessions/${st.sessionId}/end`, {method: "POST", headers: {"x-session-token": st.token}}).catch(() => {})
    resetConversation()
}

// ---------- Sending (SSE) ----------
async function readSse(body: ReadableStream<Uint8Array>, onEvent: (name: string, data: any) => void) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
        const {done, value} = await reader.read()
        if (done) break
        buffer += decoder.decode(value, {stream: true})
        let idx: number
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            let name = "message"
            let data = ""
            for (const line of raw.split("\n")) {
                if (line.startsWith("event:")) name = line.slice(6).trim()
                else if (line.startsWith("data:")) data += line.slice(5).trim()
            }
            if (!data) continue
            try {
                onEvent(name, JSON.parse(data))
            } catch {}
        }
    }
}

function removeMessage(id: string) {
    messages.value = messages.value.filter((m) => m._id !== id)
}

async function send(content: string) {
    if (preview) return previewSend(content)
    const st = stored.value
    if (!st?.token || streaming.value || showLimit.value) return
    draft.value = ""
    banner.value = ""
    const userId = `local-u${++localId}`
    const botId = `local-a${localId}`
    messages.value.push({_id: userId, role: "user", content})
    const user = messages.value[messages.value.length - 1]!
    const bot = reactive<ChatUiMessage>({_id: botId, role: "assistant", content: "", streaming: true})
    const showBot = () => {
        if (!messages.value.some((m) => m._id === botId)) messages.value.push(bot)
    }
    let handedOff = false
    // No typing indicator while a human handles the conversation
    if (!humanHandling.value) showBot()
    streaming.value = true
    scrollToBottom(true)
    stick.value = true

    try {
        const res = await fetch(`${api}/sessions/${st.sessionId}/messages`, {
            method: "POST",
            headers: {"content-type": "application/json", "x-session-token": st.token},
            body: JSON.stringify({content})
        })
        if (!res.ok || !res.body) {
            const data: any = await res.json().catch(() => null)
            removeMessage(userId)
            removeMessage(botId)
            if (res.status === 401) {
                resetConversation()
                introError.value = "Your conversation expired. Please start a new one."
                return
            }
            draft.value = content
            showBanner(data?.statusMessage || data?.message || `Request failed (${res.status})`)
            return
        }
        await readSse(res.body, (name, data) => {
            if (name === "meta") {
                user._id = data.userMessageId
                if (session.value) session.value.userMessageCount++
            } else if (name === "delta") {
                showBot()
                bot.content += data.text
            } else if (name === "done") {
                showBot()
                Object.assign(bot, data.message, {streaming: false})
            } else if (name === "escalated") {
                showBot()
                Object.assign(bot, data.message, {streaming: false})
                escalation.value = data.needsEmail ? {messageId: data.message._id} : null
            } else if (name === "human") {
                handedOff = true
                removeMessage(botId)
                if (session.value) session.value.humanHandling = true
            } else if (name === "limit") {
                removeMessage(userId)
                removeMessage(botId)
                if (session.value) session.value.limitReached = true
                limit.value = {message: data.message, hasSupport: !!data.hasSupport, question: content}
                if (session.value) session.value.humanHandling = false
            } else if (name === "error") {
                showBot()
                bot.streaming = false
                bot.content = ""
                bot.error = data.message || "Something went wrong."
            }
        })
    } catch {
        if (!bot.content && !handedOff) {
            showBot()
            bot.error = "Connection lost. Please try again."
        }
    } finally {
        bot.streaming = false
        streaming.value = false
        if (!bot.content && !bot.error && messages.value.includes(bot)) bot.error = "No answer received. Please try again."
    }
}

async function sendEmail(email: string) {
    const st = stored.value
    if (!st?.token || !escalation.value) return
    emailPending.value = true
    emailError.value = ""
    try {
        const res = await $fetch<{session: PublicSession}>(`${api}/sessions/${st.sessionId}/escalate`, {
            method: "POST",
            headers: {"x-session-token": st.token},
            body: {email}
        })
        session.value = res.session
        stored.value = {...st, email}
        writeStored(stored.value)
        escalation.value = {...escalation.value, doneEmail: email}
    } catch (err) {
        emailError.value = errorText(err)
    } finally {
        emailPending.value = false
    }
}

async function sendToTeam(payload: {email: string; question: string}) {
    const st = stored.value
    if (!st?.token || !limit.value) return
    limitPending.value = true
    limitError.value = ""
    try {
        const res = await $fetch<{session: PublicSession; message?: ChatUiMessage}>(`${api}/sessions/${st.sessionId}/escalate`, {
            method: "POST",
            headers: {"x-session-token": st.token},
            body: payload
        })
        session.value = res.session
        if (res.message) messages.value.push(res.message)
        stored.value = {...st, email: payload.email}
        writeStored(stored.value)
        limit.value = {...limit.value, sent: true}
    } catch (err) {
        limitError.value = errorText(err)
    } finally {
        limitPending.value = false
    }
}

// ---------- Embed / preview ----------
function closeEmbed() {
    let target = "*"
    try {
        if (parentParam) target = new URL(parentParam).origin
    } catch {}
    window.parent?.postMessage({type: "ragpulse:close"}, target)
}

function previewSend(content: string) {
    draft.value = ""
    messages.value.push({_id: `p-u${++localId}`, role: "user", content})
    messages.value.push({_id: `p-a${localId}`, role: "assistant", content: "This is a **preview**. Real answers will appear here once the chat is live."})
}

function onMessage(e: MessageEvent) {
    if (e.origin !== adminOrigin || e.data?.type !== "ragpulse:theme") return
    if (e.data.theme && typeof e.data.theme === "object") themeOverride.value = e.data.theme
    if (typeof e.data.title === "string") titleOverride.value = e.data.title
}

// The widget was closed: clears the server-side presence flag so pending team answers get emailed
function reportClosed() {
    const st = stored.value
    if (!st) return
    $fetch(`${api}/sessions/${st.sessionId}`, {headers: {"x-session-token": st.token}, query: {visible: 0}}).catch(() => {})
}

function onEmbedMessage(e: MessageEvent) {
    if (e.source !== window.parent || e.data?.type !== "ragpulse:visibility") return
    if (parentParam && e.origin !== urlOrigin(parentParam)) return
    const wasOpen = panelOpen.value
    panelOpen.value = !!e.data.open
    if (panelOpen.value && phase.value === "chat") loadSession(true)
    else if (wasOpen && !panelOpen.value && phase.value === "chat") reportClosed()
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && embed) closeEmbed()
}

function onResize() {
    scrollToBottom()
}

function onVisible() {
    if (document.visibilityState === "visible" && phase.value === "chat" && Date.now() - lastPoll > 3000) loadSession(true)
}

let pollTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    window.addEventListener("keydown", onKeydown)
    window.addEventListener("resize", onResize, {passive: true})
    if (preview) {
        window.addEventListener("message", onMessage)
        stored.value = {sessionId: "preview", token: "", name: "Alex"}
        messages.value = [
            {_id: "p1", role: "user", content: "Hi! Do you offer a free trial?"},
            {
                _id: "p2",
                role: "assistant",
                content: "Yes! Every plan starts with a **14-day free trial**, no credit card required.\n\n- Full access to all features\n- Cancel anytime from your [account settings](#)",
                sources: [
                    {title: "Pricing", url: "https://example.com/pricing", kind: "docs"},
                    {title: "Getting started", url: "https://example.com/docs", kind: "docs"},
                    {title: "src/billing/trial.ts", url: "https://example.com/code", kind: "code"}
                ]
            },
            {_id: "p3", role: "agent", content: "Hi Alex, Sam from the team here. Happy to help you set things up!"}
        ]
        phase.value = "chat"
        if (window.parent !== window) window.parent.postMessage({type: "ragpulse:ready"}, adminOrigin)
        return
    }
    if (embed) window.addEventListener("message", onEmbedMessage)
    stored.value = readStored()
    if (stored.value) loadSession()
    else phase.value = "intro"
    pollTimer = setInterval(() => {
        if (document.visibilityState === "visible" && phase.value === "chat") loadSession(true)
    }, POLL_MS)
    window.addEventListener("focus", onVisible)
    document.addEventListener("visibilitychange", onVisible)
})

onBeforeUnmount(() => {
    clearInterval(pollTimer)
    clearTimeout(bannerTimer)
    window.removeEventListener("keydown", onKeydown)
    window.removeEventListener("resize", onResize)
    window.removeEventListener("message", onMessage)
    window.removeEventListener("message", onEmbedMessage)
    window.removeEventListener("focus", onVisible)
    document.removeEventListener("visibilitychange", onVisible)
})
</script>

<template>
    <div class="rp" :class="[`rp-${theme.mode}`, {'rp-embed': embed}]" :style="vars">
        <header class="rp-head">
            <div class="rp-avatar" :class="{'rp-avatar-icon': botIcon}" aria-hidden="true">
                <img v-if="botIcon" :src="botIcon" alt="" />
                <template v-else>{{ botInitial }}</template>
            </div>
            <div class="rp-id">
                <p class="rp-name">{{ botName }}</p>
                <p class="rp-sub">
                    <span class="rp-pulse" aria-hidden="true" /><span class="rp-trunc">{{ title }}</span
                    ><span class="rp-sep">·</span>{{ humanHandling ? "support team" : "online" }}
                </p>
            </div>
            <button v-if="phase === 'chat' && !preview" class="rp-icon" type="button" title="New conversation" aria-label="New conversation" :disabled="streaming" @click="newConversation">
                <RotateCcw :size="17" />
            </button>
            <button v-if="embed" class="rp-icon" type="button" title="Close" aria-label="Close chat" @click="closeEmbed">
                <X :size="19" />
            </button>
        </header>

        <main ref="scroller" class="rp-scroll" aria-live="polite" @scroll.passive="onScroll">
            <div class="rp-col">
                <ChatBubble :message="welcome" :bot-initial="botInitial" :bot-icon="botIcon" />
                <template v-for="(m, i) in messages" :key="m._id">
                    <ChatBubble :message="m" :bot-initial="botInitial" :bot-icon="botIcon" :grouped="i > 0 ? messages[i - 1]!.role === m.role && m.role !== 'user' : m.role === 'assistant'">
                        <ChatEmailCard
                            v-if="escalation && escalation.messageId === m._id && !preview && (escalation.doneEmail || !session?.visitorEmail)"
                            :pending="emailPending"
                            :error="emailError"
                            :done-email="escalation.doneEmail"
                            :has-support="config?.hasSupport"
                            @submit="sendEmail"
                        />
                    </ChatBubble>
                </template>

                <div v-if="phase === 'loading'" class="rp-loading" aria-label="Loading conversation"><span /><span /></div>
                <ChatIntro v-else-if="phase === 'intro'" class="rp-in" :pending="introPending" :error="introError" :initial-name="stored?.name" :initial-email="stored?.email" @submit="startSession" />
                <ChatLimitCard
                    v-if="limit && showLimit && phase === 'chat'"
                    class="rp-in"
                    :message="limit.message"
                    :sent="limit.sent"
                    :pending="limitPending"
                    :error="limitError"
                    :initial-email="session?.visitorEmail || stored?.email"
                    :initial-question="limit.question"
                    @submit="sendToTeam"
                />
            </div>
        </main>

        <footer class="rp-foot">
            <div class="rp-col">
                <p v-if="banner" class="rp-banner" role="alert">{{ banner }}</p>
                <ChatComposer v-if="phase === 'chat' && !showLimit" ref="composer" v-model="draft" :placeholder="theme.placeholder" :busy="streaming" :max="MAX_CHARS" :hint="composerHint" @send="send" />
                <p class="rp-powered">Powered by <a href="https://github.com/ramadasnet/ragpulse" target="_blank" rel="noopener">RAGPulse</a></p>
            </div>
        </footer>
    </div>
</template>

<style>
/* Shared form styles for the chat cards (scoped to the chat root) */
.rp .c-card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 18px;
    padding: 18px;
    box-shadow: var(--c-shadow);
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
    margin-left: 38px;
}
.rp .c-card.compact {
    margin: 2px 0 0;
    padding: 12px;
    border-radius: 14px;
    gap: 8px;
}
.rp .c-card.intro {
    position: relative;
    overflow: hidden;
}
.rp .c-card.intro::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    background: linear-gradient(90deg, var(--c-accent), var(--c-accent2), var(--c-highlight));
}
.rp .c-card-title {
    font-weight: 650;
    font-size: 15px;
    margin: 0;
}
.rp .c-card-text {
    color: var(--c-muted);
    font-size: 13px;
    margin: 2px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
}
.rp .c-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.rp .c-label {
    font-size: 12.5px;
    font-weight: 550;
    color: var(--c-text);
}
.rp .c-opt {
    font-weight: 400;
    color: var(--c-dim);
}
.rp .c-input {
    width: 100%;
    background: var(--c-bg);
    color: var(--c-text);
    border: 1px solid var(--c-border);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 14.5px;
    outline: none;
    transition:
        border-color 0.15s,
        box-shadow 0.15s;
    min-width: 0;
}
.rp textarea.c-input {
    resize: vertical;
    min-height: 76px;
    line-height: 1.5;
}
.rp .c-input::placeholder {
    color: var(--c-dim);
}
.rp .c-input:focus {
    border-color: var(--c-highlight);
    box-shadow: var(--c-ring);
}
.rp .c-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 42px;
    padding: 0 16px;
    border: 0;
    border-radius: 12px;
    background: var(--c-accent);
    color: var(--c-accent-ink);
    font-weight: 600;
    font-size: 14px;
    transition:
        transform 0.12s var(--ease),
        opacity 0.15s;
}
.rp .c-btn.sm {
    height: 40px;
    padding: 0 14px;
    flex-shrink: 0;
}
.rp .c-btn:hover:not(:disabled) {
    transform: translateY(-1px);
}
.rp .c-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.rp .c-row {
    display: flex;
    gap: 8px;
}
.rp .c-form,
.rp .c-inline {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.rp .c-error {
    color: #f87171;
    font-size: 12.5px;
    margin: 0;
}
.rp .c-done {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 13.5px;
    color: var(--c-text);
}
.rp .c-done svg {
    color: var(--c-highlight);
    flex-shrink: 0;
}
.rp .c-spin {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: rp-spin 0.7s linear infinite;
}
@keyframes rp-spin {
    to {
        transform: rotate(360deg);
    }
}
/* Keeps an open sources overlay above the following messages */
.rp .msg:has(.src-pop) {
    position: relative;
    z-index: 3;
}
.rp :focus-visible {
    outline: none;
    box-shadow: var(--c-ring);
}
.rp ::selection {
    background: var(--c-highlight-soft);
    color: inherit;
}
</style>

<style scoped>
.rp {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--c-bg);
    color: var(--c-text);
    font-family: var(--font-sans);
    font-size: 14.5px;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
}
.rp-light {
    color-scheme: light;
}
.rp-dark {
    color-scheme: dark;
}

.rp-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    padding: calc(12px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right), calc((100% - 760px) / 2)) 12px max(16px, env(safe-area-inset-left), calc((100% - 760px) / 2));
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-border);
}
.rp-head::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    background: linear-gradient(90deg, var(--c-accent), var(--c-accent2));
}
.rp-avatar {
    width: 40px;
    height: 40px;
    border-radius: 13px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 17px;
    background: linear-gradient(135deg, var(--c-accent), var(--c-accent2));
    color: var(--c-accent-ink);
    box-shadow: 0 6px 18px -6px var(--c-accent);
}
.rp-avatar-icon {
    background: #fff;
    padding: 5px;
    box-shadow: inset 0 0 0 1px var(--c-border);
}
.rp-avatar img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.rp-id {
    flex: 1;
    min-width: 0;
}
.rp-name {
    margin: 0;
    font-weight: 650;
    font-size: 15.5px;
    letter-spacing: -0.01em;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.rp-sub {
    margin: 2px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--c-muted);
    min-width: 0;
}
.rp-trunc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.rp-sep {
    color: var(--c-dim);
}
.rp-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #34d399;
    flex-shrink: 0;
    position: relative;
}
.rp-pulse::after {
    content: "";
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 2px solid #34d399;
    opacity: 0;
    animation: rp-ping 2.2s var(--ease) infinite;
}
@keyframes rp-ping {
    0% {
        transform: scale(0.6);
        opacity: 0.7;
    }
    80%,
    100% {
        transform: scale(1.6);
        opacity: 0;
    }
}
.rp-icon {
    width: 36px;
    height: 36px;
    border-radius: 11px;
    border: 0;
    background: transparent;
    color: var(--c-muted);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition:
        background 0.15s,
        color 0.15s;
}
.rp-icon:hover:not(:disabled) {
    background: var(--c-surface-2);
    color: var(--c-text);
}
.rp-icon:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.rp-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 20px max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left));
    scrollbar-width: thin;
    scrollbar-color: var(--c-surface-2) transparent;
}
.rp-col {
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
}
.rp-in {
    animation: rp-rise 0.35s var(--ease) both;
}
@keyframes rp-rise {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
}

.rp-loading {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 16px 0 0 38px;
}
.rp-loading span {
    height: 40px;
    border-radius: 14px;
    background: var(--c-surface);
    animation: rp-fade 1.2s ease-in-out infinite alternate;
}
.rp-loading span:nth-child(1) {
    width: 55%;
    margin-left: auto;
}
.rp-loading span:nth-child(2) {
    width: 70%;
}
@keyframes rp-fade {
    to {
        opacity: 0.4;
    }
}

.rp-foot {
    flex-shrink: 0;
    padding: 8px max(12px, env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
}
.rp-banner {
    margin: 0 0 8px;
    padding: 8px 12px;
    border-radius: 12px;
    font-size: 13px;
    background: rgb(248 113 113 / 0.12);
    color: #f87171;
}
.rp-powered {
    margin: 8px 0 0;
    text-align: center;
    font-size: 11px;
    color: var(--c-dim);
    letter-spacing: 0.01em;
}
.rp-powered a {
    color: var(--c-muted);
    font-weight: 600;
}
.rp-powered a:hover {
    color: var(--c-text);
}

@media (prefers-reduced-motion: reduce) {
    .rp-pulse::after,
    .rp-in,
    .rp-loading span {
        animation: none;
    }
    .rp-scroll {
        scroll-behavior: auto;
    }
}
</style>
