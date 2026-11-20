<script setup lang="ts">
import {ArrowLeft, FileQuestion} from "lucide-vue-next"
import {DEFAULT_REFRESH_HOURS, type SourceView} from "#shared/types"

const route = useRoute()
const projectId = useProjectId()
const sourceId = computed(() => String(route.params.sourceId))
const allowed = await guardProjectPage(projectId.value!, "sources:manage")
const {projects, refresh: refreshProjects} = useProjects()

const {
    data: source,
    error,
    status
} = useFetch<SourceView>(() => `/api/projects/${projectId.value}/sources/${sourceId.value}`, {
    lazy: true,
    immediate: allowed,
    server: false
})

const project = computed(() => projects.value.find((p) => p._id === projectId.value))
const projectHours = computed(() => project.value?.refreshIntervalHours ?? DEFAULT_REFRESH_HOURS)
const typeInfo = computed(() => sourceTypeInfo(source.value?.type ?? "url"))
const backTo = computed(() => `/admin/projects/${projectId.value}/knowledge`)
const form = ref<{pending: boolean} | null>(null)

useHead({title: () => `${source.value?.title ? `Edit ${source.value.title}` : "Edit source"} · RAGPulse`})

async function onSaved() {
    refreshProjects().catch(() => {})
    await navigateTo(backTo.value)
}
</script>

<template>
    <div class="page narrow">
        <NuxtLink :to="backTo" class="back small muted"><ArrowLeft :size="14" /> Knowledge</NuxtLink>

        <header class="page-header">
            <div style="min-width: 0">
                <p class="eyebrow">{{ project?.title }}</p>
                <h1>Edit source</h1>
                <p v-if="source" class="truncate">{{ source.title }}</p>
            </div>
        </header>

        <UiEmpty v-if="error" :icon="FileQuestion" title="Source not found" :description="errorMessage(error)">
            <UiButton size="sm" :to="backTo">Back to Knowledge</UiButton>
        </UiEmpty>

        <div v-else-if="status === 'pending' || !source" class="panel panel-pad stack" style="--gap: 16px">
            <div class="skeleton" style="width: 30%; height: 16px" />
            <div v-for="i in 3" :key="i" class="skeleton" style="height: 38px" />
        </div>

        <UiCard v-else>
            <template #header>
                <div class="row type-row" style="--gap: 12px">
                    <span class="type-icon" :class="`type-${source.type}`"><component :is="typeInfo.icon" :size="16" /></span>
                    <div class="stack" style="--gap: 2px">
                        <h2 class="card-title">{{ typeInfo.label }}</h2>
                        <p class="muted small">The type of a source can't be changed. To index other content, add a new source.</p>
                    </div>
                </div>
            </template>

            <KnowledgeSourceForm id="source-edit-form" ref="form" :project-id="projectId!" :type="source.type" :source="source" :project-hours="projectHours" @saved="onSaved" />

            <template #footer>
                <UiButton variant="ghost" :to="backTo">Cancel</UiButton>
                <UiButton variant="primary" type="submit" form="source-edit-form" :loading="form?.pending">Save changes</UiButton>
            </template>
        </UiCard>
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
.card-title {
    font-size: 15px;
}
.type-icon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: var(--accent-soft);
    color: var(--accent);
}
.type-icon.type-git {
    background: var(--violet-soft);
    color: var(--violet);
}
.type-icon.type-drive {
    background: var(--info-soft);
    color: var(--info);
}
</style>
