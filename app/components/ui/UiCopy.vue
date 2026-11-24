<script setup lang="ts">
const props = defineProps<{value: string; multiline?: boolean; label?: string}>()
const copied = ref(false)
async function copy() {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
    <div class="copy" :class="{multiline}">
        <pre v-if="multiline" class="code-block">{{ value }}</pre>
        <code v-else class="control copy-inline truncate">{{ value }}</code>
        <UiButton size="sm" :variant="copied ? 'subtle' : 'secondary'" class="copy-btn" @click="copy">
            {{ copied ? "Copied" : label || "Copy" }}
        </UiButton>
    </div>
</template>

<style scoped>
.copy {
    display: flex;
    gap: 8px;
    align-items: center;
    position: relative;
}
.copy-inline {
    display: flex;
    align-items: center;
    font-size: 12.5px;
    color: #cfd6e4;
}
.multiline {
    display: block;
}
.multiline .code-block {
    margin-top: 0;
    padding-inline-end: 80px;
}
.multiline .copy-btn {
    position: absolute;
    top: 10px;
    right: 8px;
}
</style>
