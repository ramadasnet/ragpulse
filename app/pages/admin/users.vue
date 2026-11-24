<script setup lang="ts">
import {Ban, CheckCircle2, MailPlus, Pencil, Trash2, Users} from "lucide-vue-next"
import type {ProjectAccess, ProjectPermission, Role} from "#shared/types"
import {PERMISSION_INFO, PROJECT_PERMISSIONS} from "#shared/types"
import {signInProviderNames} from "#shared/utils/sign-in"

interface UserRow {
    _id: string
    email: string
    name: string
    avatar?: string
    role: Role
    projects: ProjectAccess[]
    disabled: boolean
    createdAt: string
    lastLoginAt?: string
    providers: {google: boolean; microsoft: boolean}
}

const {me, isAdmin} = useMe()
if (!isAdmin.value) await navigateTo("/admin", {replace: true})
useHead({title: "Users · RAGPulse"})

const {projects, ensure} = useProjects()
const {confirm} = useConfirm()
const {run} = useAction()

const {data: users, error, refresh} = useFetch<UserRow[]>("/api/users", {lazy: true, server: false, immediate: isAdmin.value})
const {data: providers} = useFetch("/auth/providers", {immediate: isAdmin.value})
const providerNames = computed(() => signInProviderNames(providers.value))
const inviteDescription = computed(() => `${providerNames.value ? `They can sign in with ${providerNames.value} using this email. ` : ""}We email them an invite if SMTP is configured.`)
onMounted(ensure)

const projectTitle = (id: string) => projects.value.find((p) => p._id === id)?.title || "Deleted project"

// ----- Invite / edit modal -----
const modalOpen = ref(false)
const editing = ref<UserRow | null>(null)
const form = reactive({email: "", name: "", role: "assistant" as Role, access: {} as Record<string, ProjectPermission[]>})
const saving = useAction()
const permissions = PROJECT_PERMISSIONS

function openInvite() {
    editing.value = null
    Object.assign(form, {email: "", name: "", role: "assistant", access: {}})
    modalOpen.value = true
}

function openEdit(user: UserRow) {
    editing.value = user
    Object.assign(form, {
        email: user.email,
        name: user.name,
        role: user.role,
        access: Object.fromEntries(user.projects.map((p) => [p.projectId, [...p.permissions]]))
    })
    modalOpen.value = true
}

function has(projectId: string, perm: ProjectPermission) {
    return form.access[projectId]?.includes(perm) ?? false
}
function togglePerm(projectId: string, perm: ProjectPermission) {
    const current = form.access[projectId] ?? []
    form.access[projectId] = current.includes(perm) ? current.filter((p) => p !== perm) : [...current, perm]
}
function rowState(projectId: string): "all" | "some" | "none" {
    const n = form.access[projectId]?.length ?? 0
    return n === 0 ? "none" : n === permissions.length ? "all" : "some"
}
function toggleRow(projectId: string) {
    form.access[projectId] = rowState(projectId) === "all" ? [] : [...permissions]
}
function toggleColumn(perm: ProjectPermission) {
    const allOn = projects.value.every((p) => has(p._id, perm))
    for (const p of projects.value) {
        const current = form.access[p._id] ?? []
        form.access[p._id] = allOn ? current.filter((x) => x !== perm) : [...new Set([...current, perm])]
    }
}

const emailError = computed(() => (!editing.value && form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? "Enter a valid email" : undefined))
const isSelf = computed(() => !!editing.value && editing.value._id === me.value?._id)
const roleOptions = [
    {value: "assistant", label: "Assistant — access to selected projects"},
    {value: "admin", label: "Admin — full access to everything"}
]

async function submit() {
    if (!editing.value && (!form.email.trim() || emailError.value)) return
    const projectsBody =
        form.role === "admin"
            ? []
            : Object.entries(form.access)
                  .filter(([, perms]) => perms.length)
                  .map(([projectId, perms]) => ({projectId, permissions: perms}))
    const target = editing.value
    const result = target
        ? await saving.run(
              () =>
                  $fetch<UserRow>(`/api/users/${target._id}` as string, {
                      method: "PATCH",
                      body: {name: form.name.trim() || undefined, role: isSelf.value ? undefined : form.role, projects: projectsBody}
                  }),
              "User updated"
          )
        : await saving.run(
              () =>
                  $fetch<UserRow>("/api/users" as string, {
                      method: "POST",
                      body: {email: form.email.trim(), name: form.name.trim() || undefined, role: form.role, projects: projectsBody}
                  }),
              "Invitation created"
          )
    if (!result) return
    modalOpen.value = false
    await refresh()
}

async function setDisabled(user: UserRow, disabled: boolean) {
    if (disabled && !(await confirm({title: `Disable ${user.name}?`, message: "They will be signed out of the admin and their API tokens stop working until re-enabled.", confirmLabel: "Disable", danger: true}))) return
    const ok = await run(() => $fetch<UserRow>(`/api/users/${user._id}` as string, {method: "PATCH", body: {disabled}}), disabled ? "User disabled" : "User enabled")
    if (ok) await refresh()
}

async function remove(user: UserRow) {
    if (!(await confirm({title: `Delete ${user.name}?`, message: `${user.email} loses access and their API tokens are revoked. You can invite them again later.`, confirmLabel: "Delete user", danger: true}))) return
    const ok = await run(() => $fetch<{ok: boolean}>(`/api/users/${user._id}` as string, {method: "DELETE"}), "User deleted")
    if (ok) await refresh()
}

function accessSummary(user: UserRow) {
    if (user.role === "admin") return "All projects"
    const n = user.projects.length
    return n ? `${n} project${n === 1 ? "" : "s"}` : "No projects"
}
</script>

<template>
    <div class="page">
        <header class="page-header">
            <div>
                <p class="eyebrow">Workspace</p>
                <h1>Users</h1>
                <p>
                    Invite teammates. Admins manage everything; assistants get per-project permissions.<template v-if="providerNames"> Sign-in is via {{ providerNames }} with the invited email.</template>
                </p>
            </div>
            <UiButton variant="primary" @click="openInvite"><MailPlus :size="16" /> Invite user</UiButton>
        </header>

        <p v-if="error" class="panel panel-pad danger-text">{{ errorMessage(error) }}</p>

        <div v-else-if="!users" class="table-wrap">
            <div v-for="i in 4" :key="i" class="skel-row">
                <div class="skeleton" style="width: 28px; height: 28px; border-radius: 50%" />
                <div class="skeleton grow" style="height: 14px" />
                <div class="skeleton" style="width: 90px; height: 14px" />
            </div>
        </div>

        <UiEmpty v-else-if="!users.length" :icon="Users" title="No users" description="Invite your first teammate." />

        <div v-else class="table-wrap">
            <table class="table">
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th class="hide-sm">Access</th>
                        <th class="hide-sm">Last login</th>
                        <th>Status</th>
                        <th><span class="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="u in users" :key="u._id" :class="{off: u.disabled}">
                        <td>
                            <div class="who">
                                <span class="avatar"
                                    ><img v-if="u.avatar" :src="u.avatar" alt="" referrerpolicy="no-referrer" /><template v-else>{{ initials(u.name) }}</template></span
                                >
                                <span class="who-text">
                                    <span class="truncate strong">{{ u.name }} <span v-if="u._id === me?._id" class="dim small">(you)</span></span>
                                    <span class="truncate tiny dim">{{ u.email }}</span>
                                </span>
                            </div>
                        </td>
                        <td>
                            <UiBadge :tone="u.role === 'admin' ? 'accent' : 'violet'">{{ u.role === "admin" ? "Admin" : "Assistant" }}</UiBadge>
                        </td>
                        <td class="hide-sm small muted">
                            <span :title="u.role === 'admin' ? '' : u.projects.map((p) => projectTitle(p.projectId)).join(', ')">{{ accessSummary(u) }}</span>
                        </td>
                        <td class="hide-sm small muted nowrap" :title="u.lastLoginAt ? formatDate(u.lastLoginAt, true) : ''">{{ u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never" }}</td>
                        <td>
                            <UiBadge v-if="u.disabled" tone="danger">Disabled</UiBadge>
                            <UiBadge v-else-if="!u.lastLoginAt" tone="info">Invited</UiBadge>
                            <UiBadge v-else tone="success">Active</UiBadge>
                        </td>
                        <td class="actions">
                            <UiButton size="sm" variant="ghost" icon :aria-label="`Edit ${u.name}`" title="Edit" @click="openEdit(u)"><Pencil :size="14" /></UiButton>
                            <template v-if="u._id !== me?._id">
                                <UiButton v-if="u.disabled" size="sm" variant="ghost" icon :aria-label="`Enable ${u.name}`" title="Enable" @click="setDisabled(u, false)"><CheckCircle2 :size="14" /></UiButton>
                                <UiButton v-else size="sm" variant="ghost" icon :aria-label="`Disable ${u.name}`" title="Disable" @click="setDisabled(u, true)"><Ban :size="14" /></UiButton>
                                <UiButton size="sm" variant="ghost" icon class="del" :aria-label="`Delete ${u.name}`" title="Delete" @click="remove(u)"><Trash2 :size="14" /></UiButton>
                            </template>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <UiModal v-model:open="modalOpen" :title="editing ? `Edit ${editing.name}` : 'Invite user'" :description="editing ? editing.email : inviteDescription" width="760px">
            <form id="user-form" class="stack" style="--gap: 16px" novalidate @submit.prevent="submit">
                <div class="grid-2">
                    <UiInput v-if="!editing" v-model="form.email" type="email" label="Email" placeholder="jane@company.com" :error="emailError" autofocus />
                    <UiInput v-model="form.name" label="Name" optional placeholder="Jane Doe" maxlength="120" />
                    <UiSelect v-model="form.role" label="Role" :options="roleOptions" :disabled="isSelf" :hint="isSelf ? 'You cannot change your own role.' : undefined" />
                </div>

                <div v-if="form.role === 'assistant'" class="stack" style="--gap: 8px">
                    <p class="field-label">Project permissions</p>
                    <p v-if="!projects.length" class="muted small">No projects yet. Create a project first, then grant access.</p>
                    <div v-else class="table-wrap matrix-wrap">
                        <table class="table matrix">
                            <thead>
                                <tr>
                                    <th>Project</th>
                                    <th class="c">All</th>
                                    <th v-for="perm in permissions" :key="perm" class="c">
                                        <button type="button" class="col-btn" :title="`${PERMISSION_INFO[perm].description} — click to toggle for all projects`" @click="toggleColumn(perm)">
                                            {{ PERMISSION_INFO[perm].label }}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="p in projects" :key="p._id" :class="{granted: rowState(p._id) !== 'none'}">
                                    <td class="truncate pname">{{ p.title }}</td>
                                    <td class="c">
                                        <input type="checkbox" :checked="rowState(p._id) === 'all'" :indeterminate.prop="rowState(p._id) === 'some'" :aria-label="`All permissions for ${p.title}`" @change="toggleRow(p._id)" />
                                    </td>
                                    <td v-for="perm in permissions" :key="perm" class="c">
                                        <input type="checkbox" :checked="has(p._id, perm)" :aria-label="`${PERMISSION_INFO[perm].label} on ${p.title}`" @change="togglePerm(p._id, perm)" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="tiny dim">Projects without any permission are not visible to this user.</p>
                </div>
                <p v-else class="small muted admin-note">Admins can manage every project, users and system settings.</p>
            </form>
            <template #footer>
                <UiButton variant="ghost" @click="modalOpen = false">Cancel</UiButton>
                <UiButton variant="primary" type="submit" form="user-form" :loading="saving.pending.value">{{ editing ? "Save changes" : "Send invite" }}</UiButton>
            </template>
        </UiModal>
    </div>
</template>

<style scoped>
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
.who {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    max-width: 340px;
}
.who-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.35;
}
tr.off td:not(.actions) {
    opacity: 0.55;
}
.del:hover {
    color: var(--danger) !important;
}
.matrix-wrap {
    background: var(--bg-elev);
}
.matrix td,
.matrix th {
    padding: 8px 10px;
}
.matrix th {
    text-transform: none;
    letter-spacing: 0;
    font-size: 12px;
}
.c {
    text-align: center;
    width: 1%;
}
.pname {
    max-width: 220px;
}
.col-btn {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    white-space: nowrap;
}
.col-btn:hover {
    color: var(--text);
}
.matrix input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
    margin: 0;
    vertical-align: middle;
}
.matrix tr.granted .pname {
    color: var(--text);
    font-weight: 500;
}
.matrix tr:not(.granted) .pname {
    color: var(--text-muted);
}
.admin-note {
    padding: 12px 14px;
    background: var(--accent-soft);
    border-radius: var(--radius);
    color: var(--text);
}
@media (max-width: 720px) {
    .hide-sm {
        display: none;
    }
}
</style>
