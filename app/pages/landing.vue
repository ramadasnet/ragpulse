<script setup lang="ts">
import {BookOpenText, Bot, ChevronLeft, ChevronRight, CircleQuestionMark, FileCode, FileText, FolderOpen, GitBranch, Github, Globe, MailQuestionMark, MessagesSquare, SendHorizontal, Server, Users, X} from "lucide-vue-next"

definePageMeta({layout: "blank"})

useHead({
    title: "RAGPulse · Self-hosted AI support chat",
    meta: [
        {name: "description", content: "RAGPulse indexes your own data, embeds a fast chat on your sites and hands the questions it can't answer to your team, or your agents over MCP."},
        {property: "og:title", content: "RAGPulse · Self-hosted AI support chat"},
        {property: "og:description", content: "Index your knowledge, embed a fast chat, escalate what the AI can't answer. All on your own servers."},
        {property: "og:type", content: "website"},
        {property: "og:url", content: "https://ragpulse.dev"}
    ],
    link: [{rel: "canonical", href: "https://ragpulse.dev"}]
})

const repo = "https://github.com/ramadasnet/ragpulse"
const docs = "https://deepwiki.com/ramadasnet/ragpulse"

const sources = [
    {icon: CircleQuestionMark, label: "FAQ"},
    {icon: Globe, label: "Websites"},
    {icon: GitBranch, label: "Git repos"},
    {icon: FolderOpen, label: "Google Drive"}
]

const features = [
    {
        icon: BookOpenText,
        title: "Data sources",
        text: "FAQ pairs, crawled pages, repo docs and code, Drive folders and Office files. Everything gets parsed, indexed and embedded for fast retrieval."
    },
    {
        icon: MessagesSquare,
        title: "Chat that embeds anywhere",
        text: "One script tag for a floating launcher, or an inline iframe. Light and dark themes with your own branding and customizations on top."
    },
    {
        icon: MailQuestionMark,
        title: "Nothing falls through",
        text: "What the AI can't answer gets escalated so a human can take over. Escalations are used to improve future chat sessions."
    },
    {
        icon: Bot,
        title: "MCP for your agents",
        text: "Dedicated MCP endpoint that lets your own bots and agents handle the system and conversations for you and your team."
    },
    {
        icon: Users,
        title: "User roles",
        text: "Admins manage everything. Assistants see only their assigned projects, with granular permissions for analytics, conversations, questions and knowledge."
    },
    {
        icon: Server,
        title: "One system, many projects",
        text: "One instance can host multiple projects, each with its own knowledge base, chat, and user roles."
    }
]

const steps = [
    {
        title: "Index your knowledge",
        text: "Connect FAQ, websites, Git repos and Google Drive. Everything becomes searchable chunks with embeddings in your MongoDB and is used to power the AI chat."
    },
    {
        title: "Embed the chat",
        text: "Drop one script tag on your site for the floating launcher, or an iframe for an inline chat. Pick your colours, name the bot, give it the instructions."
    },
    {
        title: "Answer and escalate",
        text: "The AI answers strictly from your knowledge. Whatever it can't solve is escalated so your team (or your AI agents) can take over."
    }
]

const shots = [
    {label: "Overview", src: "/admin-overview.webp", mobile: "/admin-overview-mobile.webp", alt: "Admin overview: project stats for conversations, answer rate, escalations and tokens, with a daily activity chart."},
    {label: "Knowledge", src: "/admin-knowledge.webp", mobile: "/admin-knowledge-mobile.webp", alt: "Knowledge sources: a synced git repository, a website crawl and a Google Drive folder with their chunk counts."},
    {label: "Conversations", src: "/admin-conversations.webp", mobile: "/admin-conversations-mobile.webp", alt: "Chat sessions: the list of visitor conversations with message counts, status and origin."},
    {label: "Escalated", src: "/admin-escalated.webp", mobile: "/admin-escalated-mobile.webp", alt: "Escalated questions inbox: an answered visitor question with the team's reply and a follow-up box."},
    {label: "Projects", src: "/admin-projects.webp", mobile: "/admin-projects-mobile.webp", alt: "Projects workspace: project cards with chat, knowledge and chunk stats plus quick links."},
    {label: "Users", src: "/admin-users.webp", mobile: "/admin-users-mobile.webp", alt: "Users management: teammates with their role, access, last login and status."},
    {label: "System", src: "/admin-system.webp", mobile: "/admin-system-mobile.webp", alt: "System page: database usage, vector search status, sync scheduler and configuration health."}
]
const active = ref(0)
const loaded = ref(new Set<number>())
const scroller = ref<HTMLElement>()
const lightbox = ref<number | null>(null)
const lightboxShot = computed(() => (lightbox.value === null ? undefined : shots[lightbox.value]))
let loadIO: IntersectionObserver | undefined
let activeIO: IntersectionObserver | undefined

watch(lightbox, (open) => {
    if (open === null) {
        document.documentElement.style.overflow = ""
        window.removeEventListener("keydown", onShotKey)
    } else {
        document.documentElement.style.overflow = "hidden"
        window.addEventListener("keydown", onShotKey)
    }
})
function onShotKey(e: KeyboardEvent) {
    if (e.key === "Escape") lightbox.value = null
}

onMounted(() => {
    const el = scroller.value
    if (!el) return
    const items = el.querySelectorAll<HTMLElement>(".shot-item")
    loadIO = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && loaded.value.add(Number((e.target as HTMLElement).dataset.i))), {root: el, rootMargin: "0px 50% 0px 50%"})
    activeIO = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (active.value = Number((e.target as HTMLElement).dataset.i))), {root: el, threshold: 0.6})
    items.forEach((n) => {
        loadIO!.observe(n)
        activeIO!.observe(n)
    })
})
onBeforeUnmount(() => {
    loadIO?.disconnect()
    activeIO?.disconnect()
    document.documentElement.style.overflow = ""
})

function go(i: number) {
    const idx = Math.max(0, Math.min(shots.length - 1, i))
    const slide = scroller.value?.children[idx] as HTMLElement | undefined
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches
    slide?.scrollIntoView({behavior: smooth ? "smooth" : "auto", block: "nearest", inline: "center"})
}
</script>

<template>
    <div class="site">
        <div class="glow glow-top" aria-hidden="true" />
        <div class="glow glow-side" aria-hidden="true" />

        <main>
            <!-- Hero -->
            <section class="hero">
                <AppLogo class="brand" />
                <h1>Support chat that answers from <em>your own</em> knowledge</h1>
                <p class="sub">
                    RAGPulse is a self-hosted AI support chat for your apps and services. It indexes the relevant data into a private knowledge base, and self learns with its own chat sessions. It's fast, reliable, free and open source.
                </p>

                <!-- Chat mock -->
                <div class="mock panel" role="img" aria-label="Example RAGPulse conversation: a visitor asks about a free trial, the AI answers from indexed sources and a team member follows up.">
                    <div class="mock-head">
                        <span class="mock-avatar" aria-hidden="true">A</span>
                        <div class="mock-id">
                            <p class="mock-name">Ava</p>
                            <p class="mock-sub"><span class="mock-pulse" aria-hidden="true" />online</p>
                        </div>
                    </div>
                    <div class="mock-body">
                        <div class="msg user">Do you offer a free trial?</div>
                        <div class="msg bot">
                            <p>Yes! Every plan starts with a <strong>14-day free trial</strong>, no credit card required.</p>
                            <p class="sources"><span>Pricing</span><span>Getting started</span></p>
                        </div>
                        <div class="msg agent">
                            <p>Happy to help you set things up!</p>
                            <p class="who">Sam · your team</p>
                        </div>
                    </div>
                    <div class="mock-foot">
                        <span class="dim">Ask a question…</span>
                        <SendHorizontal :size="15" class="dim" aria-hidden="true" />
                    </div>
                </div>
            </section>

            <!-- Features -->
            <section id="features" class="band">
                <p class="section-title">Features</p>
                <h2>Your support chat on auto pilot</h2>
                <div class="grid-3 feat-grid">
                    <article v-for="f in features" :key="f.title" class="feat panel">
                        <span class="feat-icon" aria-hidden="true"><component :is="f.icon" :size="18" /></span>
                        <h3>{{ f.title }}</h3>
                        <p class="muted">{{ f.text }}</p>
                    </article>
                </div>
            </section>

            <!-- Admin dashboard -->
            <section class="band">
                <p class="section-title">Dashboard</p>
                <h2>Management at a glance</h2>
                <div class="shots-nav">
                    <button v-for="(s, i) in shots" :key="s.src" class="shot-tab" :class="{on: i === active}" :aria-pressed="i === active" @click="go(i)">{{ s.label }}</button>
                </div>
                <div class="shots-wrap">
                    <div ref="scroller" class="shots" role="group" aria-label="Admin dashboard screenshots">
                        <figure v-for="(s, i) in shots" :key="s.src" class="shot-item panel" :data-i="i">
                            <button v-if="loaded.has(i)" class="shot-open" :aria-label="`Enlarge screenshot: ${s.label}`" @click="lightbox = i">
                                <picture>
                                    <source :srcset="s.mobile" media="(max-width: 720px)" />
                                    <img :src="s.src" width="1920" height="1125" :alt="s.alt" loading="lazy" decoding="async" />
                                </picture>
                            </button>
                        </figure>
                    </div>
                    <button class="shot-arrow prev" aria-label="Previous screenshot" :disabled="active === 0" @click="go(active - 1)"><ChevronLeft :size="18" /></button>
                    <button class="shot-arrow next" aria-label="Next screenshot" :disabled="active === shots.length - 1" @click="go(active + 1)"><ChevronRight :size="18" /></button>
                </div>
            </section>

            <!-- How it works -->
            <section id="how" class="band">
                <p class="section-title">How it works</p>
                <h2>Zero to hero in three steps</h2>
                <ol class="steps">
                    <li v-for="(s, i) in steps" :key="s.title" class="step">
                        <span class="step-n" aria-hidden="true">0{{ i + 1 }}</span>
                        <div>
                            <h3>{{ s.title }}</h3>
                            <p class="muted">{{ s.text }}</p>
                        </div>
                    </li>
                </ol>
            </section>
        </main>

        <Teleport to="body">
            <div v-if="lightboxShot" class="lightbox" role="dialog" aria-modal="true" :aria-label="lightboxShot.label" @click="lightbox = null">
                <button class="lightbox-close" aria-label="Close"><X :size="20" /></button>
                <picture class="lightbox-shot">
                    <source :srcset="lightboxShot.mobile" media="(max-width: 720px)" />
                    <img :src="lightboxShot.src" :alt="lightboxShot.alt" />
                </picture>
            </div>
        </Teleport>

        <!-- Footer -->
        <footer class="foot">
            <div class="foot-in">
                <div class="foot-brand">
                    <AppLogo />
                    <p class="foot-by muted">by <a href="https://ramadas.net" target="_blank" rel="noopener">Ramadas.net</a></p>
                </div>
                <nav class="foot-links" aria-label="Project links">
                    <a :href="repo" target="_blank" rel="noopener"><Github :size="14" aria-hidden="true" />GitHub</a>
                    <a :href="docs" target="_blank" rel="noopener"><BookOpenText :size="14" aria-hidden="true" />Docs</a>
                </nav>
            </div>
        </footer>
    </div>
</template>

<style scoped>
.site {
    min-height: 100dvh;
    position: relative;
    overflow-x: clip;
}
.glow {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
}
.glow-top {
    width: 720px;
    height: 720px;
    top: -420px;
    left: 50%;
    transform: translateX(-50%);
    background: radial-gradient(circle, rgb(163 255 122 / 0.09), transparent 62%);
}
.glow-side {
    width: 520px;
    height: 520px;
    top: 300px;
    right: -260px;
    background: radial-gradient(circle, rgb(157 140 255 / 0.06), transparent 65%);
}

main {
    padding-bottom: 104px;
}

/* ---------- Hero ---------- */
.hero {
    max-width: 1080px;
    margin: 0 auto;
    padding: 104px 24px 40px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
}
.brand {
    display: inline-flex;
    margin-bottom: 34px;
}
.brand :deep(.logo) {
    gap: 14px;
}
.brand :deep(svg) {
    width: 46px;
    height: 46px;
}
.brand :deep(.logo-text) {
    font-size: 30px;
}
.badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    border-radius: 999px;
    padding: 5px 13px;
    font-size: 12.5px;
    color: var(--text-muted);
}
h1 {
    font-size: clamp(34px, 5.4vw, 54px);
    line-height: 1.08;
    letter-spacing: -0.03em;
    margin: 22px 0 0;
    max-width: 15ch;
}
h1 em {
    font-style: normal;
    color: var(--accent);
}
.sub {
    margin: 20px 0 0;
    max-width: 620px;
    font-size: 16px;
    line-height: 1.65;
    color: var(--text-muted);
}
/* ---------- Chat mock ---------- */
.mock {
    width: min(620px, 100%);
    margin-top: 64px;
    text-align: left;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
}
.mock-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
}
.mock-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 13px;
}
.mock-name {
    font-weight: 600;
    font-size: 13.5px;
}
.mock-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text-dim);
}
.mock-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
    animation: pulse 1.6s infinite var(--ease);
}
.mock-body {
    padding: 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.msg {
    max-width: 82%;
    padding: 10px 14px;
    border-radius: var(--radius-lg);
    font-size: 13.5px;
    line-height: 1.55;
}
.msg.user {
    align-self: flex-end;
    background: var(--surface-3);
    border-bottom-right-radius: 4px;
}
.msg.bot {
    align-self: flex-start;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-bottom-left-radius: 4px;
}
.msg.agent {
    align-self: flex-start;
    background: var(--violet-soft);
    border: 1px solid rgb(157 140 255 / 0.22);
    border-bottom-left-radius: 4px;
}
.msg .sources {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
}
.msg .sources span {
    font-size: 11px;
    color: var(--text-muted);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    padding: 2px 9px;
}
.msg .who {
    margin-top: 6px;
    font-size: 11px;
    color: var(--violet);
    font-weight: 500;
}
.mock-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 18px 18px;
    padding: 11px 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    font-size: 13px;
}

/* ---------- Sources ---------- */
.src-title {
    margin: 56px 0 14px;
}
.chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 6px 13px;
    font-size: 12.5px;
}

/* ---------- Bands ---------- */
.band {
    max-width: 1080px;
    margin: 0 auto;
    padding: 88px 24px 0;
}
.band h2 {
    font-size: clamp(24px, 3.4vw, 32px);
    letter-spacing: -0.02em;
    margin: 8px 0 30px;
}
.feat-grid {
    gap: 14px;
}
.feat {
    padding: 22px;
    transition:
        border-color 0.15s var(--ease),
        transform 0.18s var(--ease);
}
.feat:hover {
    border-color: var(--border-strong);
    transform: translateY(-2px);
}
.feat-icon {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent);
    margin-bottom: 14px;
}
.feat h3 {
    font-size: 15px;
    margin-bottom: 8px;
}
.feat p {
    font-size: 13.5px;
    line-height: 1.6;
}

/* ---------- Steps ---------- */
.steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
}
.step {
    display: flex;
    gap: 20px;
    padding: 22px 0;
    border-top: 1px solid var(--border);
}
.step h3 {
    font-size: 16px;
    margin-bottom: 6px;
}
.step p {
    font-size: 14px;
    line-height: 1.6;
}
.step-n {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    padding-top: 3px;
}
.snippet {
    margin-top: 8px;
}

/* ---------- Dashboard shots ---------- */
.shots-nav {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: -10px 0 18px;
}
.shot-tab {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 6px 13px;
    font-size: 12.5px;
    cursor: pointer;
    transition:
        color 0.15s var(--ease),
        background 0.15s var(--ease),
        border-color 0.15s var(--ease);
}
.shot-tab:hover {
    color: var(--text);
    border-color: var(--border-strong);
}
.shot-tab.on {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: rgb(163 255 122 / 0.3);
}
.shots-wrap {
    position: relative;
}
.shots {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    border-radius: var(--radius-lg);
}
.shots::-webkit-scrollbar {
    display: none;
}
.shot-item {
    flex: 0 0 100%;
    scroll-snap-align: center;
    aspect-ratio: 1920 / 1125;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
}
.shot-open {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
}
.shot-open picture,
.lightbox-shot {
    display: contents;
}
.shot-item img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* ---------- Lightbox ---------- */
.lightbox {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgb(0 0 0 / 0.82);
    backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    padding: 20px;
    cursor: zoom-out;
}
.lightbox img {
    display: block;
    max-width: 96vw;
    max-height: 92vh;
    width: auto;
    height: auto;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
}
.lightbox-close {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    cursor: pointer;
    transition:
        color 0.15s var(--ease),
        background 0.15s var(--ease),
        border-color 0.15s var(--ease);
}
.lightbox-close:hover {
    color: var(--text);
    background: var(--surface-3);
    border-color: #3a4150;
}
.shot-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    cursor: pointer;
    transition:
        color 0.15s var(--ease),
        background 0.15s var(--ease),
        border-color 0.15s var(--ease),
        opacity 0.15s var(--ease);
}
.shot-arrow:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-3);
    border-color: #3a4150;
}
.shot-arrow:disabled {
    opacity: 0.35;
    cursor: default;
}
.shot-arrow.prev {
    left: 12px;
}
.shot-arrow.next {
    right: 12px;
}

/* ---------- OSS ---------- */
.oss {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 28px;
    flex-wrap: wrap;
}
.oss h2 {
    margin: 0 0 6px;
    font-size: 20px;
}
.gh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    transition:
        color 0.15s var(--ease),
        background 0.15s var(--ease),
        border-color 0.15s var(--ease);
    flex-shrink: 0;
}
.gh:hover {
    color: var(--text);
    background: var(--surface-3);
    border-color: #3a4150;
}

/* ---------- Footer ---------- */
.foot {
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
}
.foot-in {
    max-width: 1080px;
    margin: 0 auto;
    padding: 44px 24px calc(44px + env(safe-area-inset-bottom, 0px));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
}
.foot-brand {
    display: flex;
    align-items: center;
    gap: 10px;
}
.foot-by {
    position: relative;
    top: 3px;
    font-size: 13px;
}
.foot-by a {
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
    text-underline-offset: 3px;
    transition: color 0.15s var(--ease);
}
.foot-by a:hover {
    color: var(--text);
}
.foot-links {
    display: flex;
    align-items: center;
    gap: 8px;
}
.foot-links a {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 13px;
    transition:
        color 0.15s var(--ease),
        background 0.15s var(--ease),
        border-color 0.15s var(--ease);
}
.foot-links a:hover {
    color: var(--text);
    background: var(--surface-3);
    border-color: #3a4150;
}

@media (max-width: 720px) {
    .foot-in {
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 18px;
    }
    .hero {
        padding-top: 64px;
    }
    .band {
        padding-top: 64px;
    }
    .step {
        gap: 14px;
    }
    .shot-arrow {
        display: none;
    }
    .shot-item {
        aspect-ratio: 390 / 844;
    }
    .lightbox {
        padding: 0;
    }
    .lightbox img {
        max-width: 100vw;
        max-height: 100dvh;
        border: 0;
        border-radius: 0;
    }
    .msg {
        max-width: 92%;
    }
    .brand :deep(svg) {
        width: 38px;
        height: 38px;
    }
    .brand :deep(.logo-text) {
        font-size: 25px;
    }
}
</style>
