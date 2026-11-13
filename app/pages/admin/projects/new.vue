<script setup lang="ts">
import {ArrowLeft} from "lucide-vue-next"
import type {Project} from "#shared/types"
import {defaultSystemInstructions} from "#shared/utils/instructions"

useHead({title: "New project · RAGPulse"})

const {isAdmin} = useMe()
if (!isAdmin.value) await navigateTo("/admin", {replace: true})

const {refresh} = useProjects()
const {run, pending} = useAction()

const form = ref({
    title: "",
    website: "",
    model: "",
    supportEmail: "",
    systemInstructions: defaultSystemInstructions("", ""),
    indexWebsite: true
})
const errors = ref<{title?: string; website?: string; supportEmail?: string}>({})

// Keep the template in sync with title/website until the user edits it by hand
const instructionsTouched = ref(false)
watch(
    () => [form.value.title, form.value.website],
    () => {
        if (!instructionsTouched.value) form.value.systemInstructions = defaultSystemInstructions(form.value.title, form.value.website)
    }
)
function onInstructionsInput() {
    instructionsTouched.value = true
}
function resetTemplate() {
    instructionsTouched.value = false
    form.value.systemInstructions = defaultSystemInstructions(form.value.title, form.value.website)
}

function normalizeWebsite(value: string) {
    const v = value.trim()
    if (v && !/^https?:\/\//i.test(v)) return `https://${v}`
    return v
}

function onWebsiteBlur() {
    form.value.website = normalizeWebsite(form.value.website)
}

function validate() {
    errors.value.title = form.value.title.trim() ? undefined : "Give your project a name"
    form.value.website = normalizeWebsite(form.value.website)
    let validUrl = false
    try {
        const u = new URL(form.value.website)
        validUrl = (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname
    } catch {}
    errors.value.website = validUrl ? undefined : "Enter a valid URL, e.g. https://example.com"
    errors.value.supportEmail = !form.value.supportEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.supportEmail.trim()) ? undefined : "Enter a valid email"
    return !errors.value.title && !errors.value.website && !errors.value.supportEmail
}

async function submit() {
    if (!validate()) return
    const project = await run(
        () =>
            $fetch<Project>("/api/projects", {
                method: "POST",
                body: {
                    title: form.value.title.trim(),
                    website: form.value.website,
                    model: form.value.model || undefined,
                    supportEmail: form.value.supportEmail.trim(),
                    systemInstructions: form.value.systemInstructions,
                    indexWebsite: form.value.indexWebsite
                }
            }),
        form.value.indexWebsite ? "Project created — indexing the website and matching its colours and icon" : "Project created — matching the website colours and icon"
    )
    if (!project) return
    await refresh().catch(() => {})
    await navigateTo(`/admin/projects/${project._id}/knowledge`)
}
</script>

<template>
    <div class="page narrow">
        <header class="page-header">
            <div>
                <NuxtLink to="/admin" class="back small muted"><ArrowLeft :size="14" /> Projects</NuxtLink>
                <h1>New project</h1>
                <p>Set up the basics. You'll add knowledge (FAQ, web pages, git repos) right after.</p>
            </div>
        </header>

        <form class="stack" style="--gap: 16px" novalidate @submit.prevent="submit">
            <UiCard title="Basics" description="Shown to visitors in the chat header and emails.">
                <div class="grid-2">
                    <UiInput v-model="form.title" label="Project name" placeholder="Acme Cloud" :error="errors.title" autofocus maxlength="120" />
                    <UiInput v-model="form.website" label="Website" placeholder="https://acme.com" :error="errors.website" inputmode="url" @blur="onWebsiteBlur" />
                </div>
                <UiToggle
                    v-model="form.indexWebsite"
                    class="index-toggle"
                    label="Add the website to the knowledge"
                    description="Crawls up to 25 pages of the website (respecting robots.txt) and keeps them up to date. You can change or remove this source later."
                />
            </UiCard>

            <UiCard title="Assistant" description="Pick the model and describe how the assistant should behave.">
                <div class="stack" style="--gap: 16px">
                    <AdminModelPicker v-model="form.model" label="Model" placeholder="Server default model" hint="Any OpenRouter chat model. Prices are USD per 1M input / output tokens." />
                    <UiTextarea v-model="form.systemInstructions" label="System instructions" :rows="14" mono hint="Combined with the retrieved knowledge on every answer." @input="onInstructionsInput">
                        <template #aside>
                            <button v-if="instructionsTouched" type="button" class="link-btn tiny" @click="resetTemplate">Reset to template</button>
                        </template>
                    </UiTextarea>
                </div>
            </UiCard>

            <UiCard title="Support" description="Where escalated questions are sent.">
                <UiInput
                    v-model="form.supportEmail"
                    type="email"
                    label="Support email"
                    optional
                    placeholder="support@acme.com"
                    :error="errors.supportEmail"
                    hint="We email this address when the assistant can't answer or a visitor asks for a human."
                />
            </UiCard>

            <div class="row end">
                <UiButton variant="ghost" to="/admin">Cancel</UiButton>
                <UiButton variant="primary" type="submit" :loading="pending">Create project</UiButton>
            </div>
        </form>
    </div>
</template>

<style scoped>
.back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
}
.back:hover {
    color: var(--text);
}
.link-btn {
    background: none;
    border: 0;
    color: var(--accent);
    padding: 0;
}
.index-toggle {
    margin-top: 16px;
}
</style>
