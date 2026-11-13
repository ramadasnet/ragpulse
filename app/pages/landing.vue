<script setup lang="ts">
import {BookOpenText, Bot, CircleQuestionMark, FileCode, FileText, FolderOpen, GitBranch, Github, Globe, MailQuestionMark, MessagesSquare, SendHorizontal, Server, Users} from "lucide-vue-next"

definePageMeta({layout: "blank"})

useHead({
    title: "RAGPulse · Self-hosted AI support chat",
    meta: [
        {name: "description", content: "RAGPulse indexes your docs, repositories and Drive into a private knowledge base, embeds a fast chat on your sites and hands the questions it can't answer to your team, or your agents over MCP."},
        {property: "og:title", content: "RAGPulse · Self-hosted AI support chat"},
        {property: "og:description", content: "Index your knowledge, embed a fast chat, escalate what the AI can't answer. All on your own servers."},
        {property: "og:type", content: "website"},
        {property: "og:url", content: "https://ragpulse.dev"}
    ],
    link: [{rel: "canonical", href: "https://ragpulse.dev"}]
})

const {chatUrl} = useRuntimeConfig().public
const chatHost =
    String(chatUrl || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "") || "chat.ragpulse.dev"
const repo = "https://github.com/ramadasnet/ragpulse"

const sources = [
    {icon: CircleQuestionMark, label: "FAQ"},
    {icon: Globe, label: "Websites"},
    {icon: GitBranch, label: "Git repositories"},
    {icon: FolderOpen, label: "Google Drive"},
    {icon: FileText, label: "PDFs & Office"},
    {icon: FileCode, label: "Source code"}
]

const features = [
    {
        icon: BookOpenText,
        title: "Your knowledge, indexed",
        text: "FAQ pairs, crawled pages, repo docs and code, Drive folders and Office files are converted to Markdown, chunked and embedded in your own MongoDB. Sources re-sync on their own schedule."
    },
    {
        icon: MessagesSquare,
        title: "Chat that embeds anywhere",
        text: "One script tag for a floating launcher, or an inline iframe. Light and dark themes with your colours, restricted to your domains, fast and accessible."
    },
    {
        icon: MailQuestionMark,
        title: "Nothing falls through",
        text: "What the AI can't answer confidently becomes an unanswered question: emailed to support, listed in the admin inbox, and the reply lands back in the visitor's chat."
    },
    {
        icon: Bot,
        title: "MCP for your agents",
        text: "A streamable HTTP MCP endpoint with personal tokens lets your own bots and agents search knowledge, read sessions and answer escalations on your behalf."
    },
    {
        icon: Users,
        title: "Team-ready roles",
        text: "Admins manage everything. Assistants see only their assigned projects, with granular permissions for analytics, conversations, questions and knowledge."
    },
    {
        icon: Server,
        title: "Self-hosted, single-tenant",
        text: "Runs on Bun and MongoDB with your own OpenRouter key. Your data stays on your infrastructure. No SaaS middleman, no per-seat pricing."
    }
]

const steps = [
    {
        title: "Index your knowledge",
        text: "Connect FAQ, websites, git repositories and Google Drive. Everything becomes searchable chunks with embeddings in your MongoDB. Unchanged documents are never re-embedded."
    },
    {
        title: "Embed the chat",
        text: "Drop one script tag on your site for the floating launcher, or an iframe for an inline chat. Pick your colours, name the bot, restrict it to your domains."
    },
    {
        title: "Answer and escalate",
        text: "The AI answers strictly from your knowledge. Whatever it can't solve is escalated to your support email and inbox, where your team or your agents over MCP reply into the chat."
    }
]
</script>

<template>
    <div class="site">
        <div class="glow glow-top" aria-hidden="true" />
        <div class="glow glow-side" aria-hidden="true" />

        <main>
            <!-- Hero -->
            <section class="hero">
                <AppLogo class="brand" />
                <p class="badge"><span class="dot busy" aria-hidden="true" />Self-hosted · Open source</p>
                <h1>Support chat that answers from <em>your own</em> knowledge.</h1>
                <p class="sub">RAGPulse indexes your docs, repositories and Drive into a private knowledge base, embeds a fast chat on your sites, and hands the questions it can't answer to your team, or your agents over MCP.</p>

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

                <!-- Sources -->
                <p class="section-title src-title">Indexes what you already have</p>
                <ul class="chips">
                    <li v-for="s in sources" :key="s.label" class="chip"><component :is="s.icon" :size="14" aria-hidden="true" />{{ s.label }}</li>
                </ul>
            </section>

            <!-- Features -->
            <section id="features" class="band">
                <p class="section-title">Features</p>
                <h2>Everything support needs. Nothing it doesn't.</h2>
                <div class="grid-3 feat-grid">
                    <article v-for="f in features" :key="f.title" class="feat panel">
                        <span class="feat-icon" aria-hidden="true"><component :is="f.icon" :size="18" /></span>
                        <h3>{{ f.title }}</h3>
                        <p class="muted">{{ f.text }}</p>
                    </article>
                </div>
            </section>

            <!-- How it works -->
            <section id="how" class="band">
                <p class="section-title">How it works</p>
                <h2>Live in three steps</h2>
                <ol class="steps">
                    <li v-for="(s, i) in steps" :key="s.title" class="step">
                        <span class="step-n" aria-hidden="true">0{{ i + 1 }}</span>
                        <div>
                            <h3>{{ s.title }}</h3>
                            <p class="muted">{{ s.text }}</p>
                        </div>
                    </li>
                </ol>
                <pre class="code-block snippet">&lt;script src="https://{{ chatHost }}/embed.js" data-project="PROJECT_ID" async&gt;&lt;/script&gt;</pre>
            </section>

            <!-- Open source -->
            <section class="band">
                <div class="oss panel">
                    <div>
                        <h2>Fully open source</h2>
                        <p class="muted">Inspect it, self-host it, make it yours. The whole stack is on GitHub.</p>
                    </div>
                    <a :href="repo" target="_blank" rel="noopener" class="gh" aria-label="View RAGPulse on GitHub"><Github :size="22" /></a>
                </div>
            </section>
        </main>
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
    max-width: 640px;
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

@media (max-width: 720px) {
    .hero {
        padding-top: 64px;
    }
    .band {
        padding-top: 64px;
    }
    .step {
        gap: 14px;
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
