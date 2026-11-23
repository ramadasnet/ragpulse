<script setup lang="ts">
import {BarChart3, Bell, BookOpen, ChevronsUpDown, Code2, Database, FolderKanban, LogOut, Menu, MessagesSquare, Palette, Plus, Settings, SlidersHorizontal, Users, Inbox, Plug, X} from "lucide-vue-next"
import type {ProjectPermission} from "#shared/types"

const {me, isAdmin, can, refresh, signOut} = useMe()
const {projects, ensure, refreshOpenQuestions} = useProjects()
const projectId = useProjectId()
const route = useRoute()
const {clear} = useUserSession()

await ensure()

const current = computed(() => projects.value.find((p) => p._id === projectId.value))
const mobileOpen = ref(false)
const switcherOpen = ref(false)
watch(
    () => route.fullPath,
    () => {
        mobileOpen.value = false
        switcherOpen.value = false
    }
)

const PROJECT_SECTIONS: Array<{suffix: string; label: string; icon: any; perm: ProjectPermission; exact?: boolean}> = [
    {suffix: "", label: "Overview", icon: BarChart3, perm: "analytics:read", exact: true},
    {suffix: "/conversations", label: "Conversations", icon: MessagesSquare, perm: "sessions:read"},
    {suffix: "/questions", label: "Escalated", icon: Inbox, perm: "questions:reply"},
    {suffix: "/knowledge", label: "Knowledge", icon: BookOpen, perm: "sources:manage"},
    {suffix: "/appearance", label: "Appearance", icon: Palette, perm: "settings:edit"},
    {suffix: "/install", label: "Install", icon: Code2, perm: "settings:edit"},
    {suffix: "/settings", label: "Settings", icon: Settings, perm: "settings:edit"}
]

const projectNav = computed(() => {
    const id = projectId.value
    if (!id) return []
    return PROJECT_SECTIONS.filter((s) => can(id, s.perm)).map((s) => ({
        to: `/admin/projects/${id}${s.suffix}`,
        label: s.label,
        icon: s.icon,
        exact: s.exact,
        badge: s.suffix === "/questions" ? current.value?.stats?.openQuestions : undefined
    }))
})

function isActive(to: string, exact?: boolean) {
    return exact ? route.path === to : route.path === to || route.path.startsWith(`${to}/`)
}

/** Active project section for the current route, used to keep the same area when switching projects. */
const activeSection = computed(() => {
    const id = projectId.value
    if (!id) return undefined
    const base = `/admin/projects/${id}`
    return PROJECT_SECTIONS.find((s) => isActive(`${base}${s.suffix}`, s.exact))
})

/** Target route when switching to another project, keeping the current project section if accessible. */
function projectSwitchTo(targetId: string) {
    const section = activeSection.value
    if (!section || !can(targetId, section.perm)) return `/admin/projects/${targetId}`
    const path = `/admin/projects/${targetId}${section.suffix}`
    if (section.suffix === "/knowledge" && typeof route.query.tab === "string") return {path, query: {tab: route.query.tab}}
    return path
}

// Keeps the Escalated badge in sync with questions escalated (or answered elsewhere) after the projects were loaded
const OPEN_QUESTIONS_POLL_MS = 30_000
let openQuestionsPoll: ReturnType<typeof setInterval> | undefined
function syncOpenQuestions() {
    const id = projectId.value
    if (!id || !can(id, "questions:reply") || document.visibilityState !== "visible") return
    refreshOpenQuestions(id).catch(() => {})
}
watch(projectId, syncOpenQuestions)

/** Renews the session when the visible dashboard regains focus or connectivity. */
let refreshingSession = false
async function refreshForegroundSession() {
    if (document.visibilityState !== "visible" || refreshingSession) return
    refreshingSession = true
    try {
        if ((await refresh()) === "unauthorized") {
            await navigateTo({path: "/login", query: route.fullPath === "/admin" ? {} : {redirect: route.fullPath}})
        }
    } finally {
        refreshingSession = false
    }
}

// A tapped push notification asks the open dashboard to show its view (public/sw.js)
function onWorkerMessage(e: MessageEvent) {
    if (e.data?.type === "navigate" && typeof e.data.path === "string" && e.data.path.startsWith("/admin")) navigateTo(e.data.path)
}

onMounted(() => {
    openQuestionsPoll = setInterval(syncOpenQuestions, OPEN_QUESTIONS_POLL_MS)
    document.addEventListener("visibilitychange", syncOpenQuestions)
    document.addEventListener("visibilitychange", refreshForegroundSession)
    window.addEventListener("focus", refreshForegroundSession)
    window.addEventListener("online", refreshForegroundSession)
    // The server-side render cannot pass its renewed cookie on, so a launch renews from the browser
    refreshForegroundSession()
    if (pushSupported()) navigator.serviceWorker.addEventListener("message", onWorkerMessage)
})
onBeforeUnmount(() => {
    clearInterval(openQuestionsPoll)
    document.removeEventListener("visibilitychange", syncOpenQuestions)
    document.removeEventListener("visibilitychange", refreshForegroundSession)
    window.removeEventListener("focus", refreshForegroundSession)
    window.removeEventListener("online", refreshForegroundSession)
    if (pushSupported()) navigator.serviceWorker.removeEventListener("message", onWorkerMessage)
})

const push = usePush()

async function logout() {
    // The next user of this device must not receive this user's notifications
    await signOut(() => push.disable().catch(() => {}))
    await clear()
    await navigateTo("/login")
}
</script>

<template>
    <div class="shell" :class="{'mobile-open': mobileOpen}">
        <aside class="sidebar">
            <div class="sidebar-top">
                <NuxtLink to="/admin" class="brand"><AppLogo /></NuxtLink>
                <button class="mobile-close btn-reset" aria-label="Close menu" @click="mobileOpen = false"><X :size="18" /></button>
            </div>

            <div class="switcher">
                <button class="switcher-btn" :aria-expanded="switcherOpen" @click="switcherOpen = !switcherOpen">
                    <ProjectMark :title="current?.title" :icon="current?.icon" class="proj-mark" />
                    <span class="grow truncate">{{ current?.title || "Select project" }}</span>
                    <ChevronsUpDown :size="15" class="dim" />
                </button>
                <div v-if="switcherOpen" class="switcher-menu panel fade-in">
                    <NuxtLink v-for="p in projects" :key="p._id" :to="projectSwitchTo(p._id)" class="switcher-item" :class="{active: p._id === projectId}" @click="switcherOpen = false">
                        <ProjectMark :title="p.title" :icon="p.icon" class="proj-mark sm" />
                        <span class="truncate">{{ p.title }}</span>
                    </NuxtLink>
                    <p v-if="!projects.length" class="dim small" style="padding: 8px 10px">No projects yet</p>
                    <NuxtLink v-if="isAdmin" to="/admin/projects/new" class="switcher-item new"><Plus :size="15" /> New project</NuxtLink>
                </div>
            </div>

            <nav class="nav">
                <template v-if="projectNav.length">
                    <p class="nav-label">Project</p>
                    <NuxtLink v-for="item in projectNav" :key="item.to" :to="item.to" class="nav-item" :class="{active: isActive(item.to, item.exact)}">
                        <component :is="item.icon" :size="16" />
                        <span class="grow">{{ item.label }}</span>
                        <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
                    </NuxtLink>
                </template>

                <p class="nav-label">Workspace</p>
                <NuxtLink to="/admin" class="nav-item" :class="{active: route.path === '/admin' || route.path === '/admin/projects/new'}"> <FolderKanban :size="16" /> <span>Projects</span> </NuxtLink>
                <NuxtLink v-if="isAdmin" to="/admin/users" class="nav-item" :class="{active: isActive('/admin/users')}"> <Users :size="16" /> <span>Users</span> </NuxtLink>
                <NuxtLink to="/admin/notifications" class="nav-item" :class="{active: isActive('/admin/notifications')}"> <Bell :size="16" /> <span>Notifications</span> </NuxtLink>
                <NuxtLink to="/admin/mcp" class="nav-item" :class="{active: isActive('/admin/mcp')}"> <Plug :size="16" /> <span>MCP &amp; API</span> </NuxtLink>
                <NuxtLink v-if="isAdmin" to="/admin/system" class="nav-item" :class="{active: isActive('/admin/system')}"> <Database :size="16" /> <span>System</span> </NuxtLink>
                <NuxtLink v-if="isAdmin" to="/admin/settings" class="nav-item" :class="{active: isActive('/admin/settings')}"> <SlidersHorizontal :size="16" /> <span>Global Settings</span> </NuxtLink>
            </nav>

            <div class="me">
                <span class="avatar"
                    ><img v-if="me?.avatar" :src="me.avatar" alt="" referrerpolicy="no-referrer" /><template v-else>{{ initials(me?.name) }}</template></span
                >
                <div class="grow" style="min-width: 0">
                    <p class="truncate strong small">{{ me?.name }}</p>
                    <p class="truncate dim tiny" :title="me?.email">{{ me?.email }}</p>
                </div>
                <button class="btn-reset icon-btn" title="Sign out" aria-label="Sign out" @click="logout"><LogOut :size="16" /></button>
            </div>
        </aside>

        <div class="backdrop" @click="mobileOpen = false" />

        <main class="main">
            <header class="mobile-bar">
                <button class="btn-reset icon-btn" aria-label="Open menu" @click="mobileOpen = true"><Menu :size="18" /></button>
                <AppLogo />
            </header>
            <slot />
        </main>
    </div>
</template>

<style scoped>
.shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    min-height: 100dvh;
}
.sidebar {
    position: sticky;
    top: 0;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    padding: 16px 12px;
}
.sidebar-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
}
.btn-reset {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
}
.icon-btn {
    padding: 6px;
    border-radius: 8px;
    color: var(--text-dim);
    display: inline-grid;
    place-items: center;
}
.icon-btn:hover {
    color: var(--text);
    background: var(--surface-2);
}
.mobile-close {
    display: none;
}

.switcher {
    position: relative;
}
.switcher-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    text-align: left;
    font-weight: 500;
}
.switcher-btn:hover {
    border-color: var(--border-strong);
}
.proj-mark {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    background: linear-gradient(135deg, var(--accent), #5eead4);
    color: var(--accent-ink);
    flex-shrink: 0;
}
.proj-mark.sm {
    width: 20px;
    height: 20px;
    font-size: 10px;
    border-radius: 6px;
}
.switcher-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 30;
    padding: 6px;
    box-shadow: var(--shadow-lg);
    max-height: 320px;
    overflow-y: auto;
}
.switcher-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 8px;
    color: var(--text-muted);
}
.switcher-item:hover,
.switcher-item.active {
    background: var(--surface-2);
    color: var(--text);
}
.switcher-item.new {
    color: var(--accent);
    border-top: 1px solid var(--border);
    border-radius: 0 0 8px 8px;
    margin-top: 4px;
}

.nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    overflow-y: auto;
}
.nav-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    padding: 14px 10px 6px;
    font-weight: 600;
}
.nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 8px;
    color: var(--text-muted);
    font-weight: 500;
    transition:
        background 0.12s var(--ease),
        color 0.12s var(--ease);
    position: relative;
}
.nav-item:hover {
    color: var(--text);
    background: var(--surface);
}
.nav-item.active {
    color: var(--text);
    background: var(--surface-2);
}
.nav-item.active::before {
    content: "";
    position: absolute;
    left: -12px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
}
.nav-badge {
    background: var(--warning-soft);
    color: var(--warning);
    font-size: 11px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 99px;
}

.me {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 8px 2px;
    border-top: 1px solid var(--border);
}
.main {
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.mobile-bar {
    display: none;
}
.backdrop {
    display: none;
}

@media (max-width: 900px) {
    .shell {
        grid-template-columns: minmax(0, 1fr);
    }
    .sidebar {
        position: fixed;
        z-index: 60;
        left: 0;
        width: 272px;
        transform: translateX(-100%);
        transition: transform 0.22s var(--ease);
    }
    .mobile-open .sidebar {
        transform: none;
        box-shadow: var(--shadow-lg);
    }
    .mobile-open .backdrop {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 50;
        background: rgb(0 0 0 / 0.5);
    }
    .mobile-close {
        display: inline-grid;
        color: var(--text-dim);
    }
    .mobile-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        background: rgb(10 11 14 / 0.85);
        backdrop-filter: blur(8px);
        z-index: 20;
    }
}
</style>
