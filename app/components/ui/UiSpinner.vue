<script setup lang="ts">
withDefaults(defineProps<{size?: number}>(), {size: 18})
</script>

<template>
    <span class="spinner" :style="{width: `${size}px`, height: `${size}px`}" role="status" aria-label="Loading" />
</template>

<style scoped>
.spinner {
    display: inline-block;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    animation: spin 0.7s linear infinite;
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
