<script setup lang="ts">
import type {SourceType, SourceView} from "#shared/types"

// Adds a source. Existing sources are edited on their own page, where the type cannot change.
const open = defineModel<boolean>("open", {default: false})
defineProps<{projectId: string; projectHours: number}>()
const emit = defineEmits<{saved: [source: SourceView]}>()

const type = ref<SourceType>("url")
const form = ref<{pending: boolean} | null>(null)

watch(open, (isOpen) => {
    if (isOpen) type.value = "url"
})

function onSaved(source: SourceView) {
    emit("saved", source)
    open.value = false
}
</script>

<template>
    <UiModal v-model:open="open" title="Add source" description="Index a website, a git repository or a Google Drive folder. Content is converted to markdown, chunked and embedded." width="600px">
        <div class="stack" style="--gap: 16px">
            <div class="segmented" role="radiogroup" aria-label="Source type">
                <button v-for="t in SOURCE_TYPES" :key="t.id" type="button" role="radio" :aria-checked="type === t.id" class="seg" :class="{active: type === t.id}" @click="type = t.id">
                    <component :is="t.icon" :size="15" /> {{ t.label }}
                </button>
            </div>
            <KnowledgeSourceForm id="source-form" ref="form" :project-id="projectId" :type="type" :project-hours="projectHours" @saved="onSaved" />
        </div>

        <template #footer>
            <UiButton variant="ghost" @click="open = false">Cancel</UiButton>
            <UiButton variant="primary" type="submit" form="source-form" :loading="form?.pending">Add & sync</UiButton>
        </template>
    </UiModal>
</template>

<style scoped>
.segmented {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.seg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 34px;
    border-radius: 8px;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    font-weight: 500;
    transition:
        background 0.15s var(--ease),
        color 0.15s var(--ease);
}
.seg:hover {
    color: var(--text);
}
.seg.active {
    background: var(--surface-3);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border-strong);
}
</style>
