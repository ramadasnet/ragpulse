<script setup lang="ts">
import {BookOpen, Inbox, MessagesSquare, Plus, Settings, Sparkles, FolderKanban} from "lucide-vue-next"
import type {ProjectPermission} from "#shared/types"

useHead({title: "Projects · RAGPulse"})

const {isAdmin} = useMe()
const {projects, loaded, refresh} = useProjects()

onMounted(() => refresh().catch((err) => useToast().error(errorMessage(err))))

function host(url: string) {
    try {
        return new URL(url).host
    } catch {
        return url
    }
}

function modelName(id: string) {
    return id.split("/").pop() || id
}

const linkDefs: Array<{path: string; label: string; icon: any; perm: ProjectPermission}> = [
    {path: "conversations", label: "Conversations", icon: MessagesSquare, perm: "sessions:read"},
    {path: "questions", label: "Unanswered", icon: Inbox, perm: "questions:reply"},
    {path: "knowledge", label: "Knowledge", icon: BookOpen, perm: "sources:manage"},
    {path: "settings", label: "Settings", icon: Settings, perm: "settings:edit"}
]

const homePath = (p: {_id: string; permissions: ProjectPermission[]}) => {
    const base = `/admin/projects/${p._id}`
    if (p.permissions.includes("analytics:read")) return base
    const first = linkDefs.find((l) => p.permissions.includes(l.perm))
    return first ? `${base}/${first.path}` : base
}
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Workspace</p>
                <h1>Projects</h1>
                <p>Each project is a support assistant for one website or app, with its own knowledge, chat widget and inbox.</p>
            </div>
            <UiButton v-if="isAdmin" variant="primary" to="/admin/projects/new"><Plus :size="16" /> New project</UiButton>
        </header>

        <div v-if="!loaded" class="cards">
            <div v-for="i in 3" :key="i" class="panel card-skel">
                <div class="skeleton" style="width: 40%; height: 18px" />
                <div class="skeleton" style="width: 60%; height: 12px" />
                <div class="skeleton" style="height: 56px; margin-top: 12px" />
            </div>
        </div>

        <UiEmpty
            v-else-if="!projects.length"
            :icon="isAdmin ? Sparkles : FolderKanban"
            :title="isAdmin ? 'Create your first assistant' : 'No projects yet'"
            :description="isAdmin ? 'Add a project for your website, feed it FAQs, docs or a git repo, and embed the chat in minutes.' : 'You have not been given access to any project yet. Ask an admin to add you.'"
        >
            <UiButton v-if="isAdmin" variant="primary" to="/admin/projects/new"><Plus :size="16" /> New project</UiButton>
        </UiEmpty>

        <div v-else class="cards">
            <article v-for="p in projects" :key="p._id" class="panel project fade-in">
                <NuxtLink :to="homePath(p)" class="project-main">
                    <div class="row" style="--gap: 12px">
                        <ProjectMark :title="p.title" :icon="p.icon" class="mark" />
                        <div class="grow">
                            <h2 class="truncate">{{ p.title }}</h2>
                            <p class="dim small truncate">{{ host(p.website) }}</p>
                        </div>
                        <UiBadge v-if="!p.enabled" tone="neutral">Paused</UiBadge>
                        <UiBadge v-else-if="p.stats.openQuestions" tone="warning">{{ p.stats.openQuestions }} open</UiBadge>
                    </div>

                    <dl class="metrics">
                        <div>
                            <dt>Chat</dt>
                            <dd>{{ formatNumber(p.stats.sessions7d) }} <span class="dim tiny">7d</span></dd>
                        </div>
                        <div>
                            <dt>Knowledge</dt>
                            <dd>{{ formatNumber(p.stats.sources) }}<span class="dim tiny"> src</span> · {{ formatNumber(p.stats.faqs) }}<span class="dim tiny"> faq</span></dd>
                        </div>
                        <div>
                            <dt>Chunks</dt>
                            <dd>{{ formatNumber(p.stats.chunks) }}</dd>
                        </div>
                    </dl>

                    <p class="model tiny">
                        <span class="dot" :class="p.enabled ? 'ok' : ''" />
                        <span class="mono truncate" :title="p.model">{{ modelName(p.model) }}</span>
                    </p>
                </NuxtLink>

                <nav class="links" aria-label="Quick links">
                    <template v-for="l in linkDefs" :key="l.path">
                        <NuxtLink v-if="p.permissions.includes(l.perm)" :to="`/admin/projects/${p._id}/${l.path}`" class="link" :title="l.label">
                            <component :is="l.icon" :size="14" />
                            <span>{{ l.label }}</span>
                            <span v-if="l.path === 'questions' && p.stats.openQuestions" class="count">{{ p.stats.openQuestions }}</span>
                        </NuxtLink>
                    </template>
                </nav>
            </article>
        </div>
    </div>
</template>

<style scoped>
.cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.card-skel {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 220px;
}
.project {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition:
        border-color 0.15s var(--ease),
        transform 0.15s var(--ease);
}
.project:hover {
    border-color: var(--border-strong);
}
.project-main {
    padding: 18px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
}
.project h2 {
    font-size: 15.5px;
}
.mark {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    font-weight: 700;
    flex-shrink: 0;
    background: linear-gradient(135deg, var(--accent), #5eead4);
    color: var(--accent-ink);
}
.metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
    padding: 12px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.metrics dt {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
.metrics dd {
    margin: 2px 0 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.model {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    min-width: 0;
}
.links {
    display: flex;
    border-top: 1px solid var(--border);
    overflow-x: auto;
}
.link {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 8px;
    font-size: 12.5px;
    color: var(--text-muted);
    white-space: nowrap;
    transition:
        background 0.12s,
        color 0.12s;
}
.link + .link {
    border-left: 1px solid var(--border);
}
.link:hover {
    background: var(--surface-2);
    color: var(--text);
}
.count {
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 11px;
    font-weight: 600;
    padding: 0 6px;
    border-radius: 99px;
}
@container (max-width: 400px) {
    .link span:not(.count) {
        display: none;
    }
}
@media (max-width: 720px) {
    .cards {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
