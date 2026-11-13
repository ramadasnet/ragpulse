<script setup lang="ts">
const model = defineModel<boolean>({default: false})
defineProps<{label?: string; description?: string; disabled?: boolean}>()
</script>

<template>
    <label class="toggle" :class="{disabled}">
        <span v-if="label || description" class="toggle-text">
            <span class="toggle-label">{{ label }}</span>
            <span v-if="description" class="toggle-desc">{{ description }}</span>
        </span>
        <button type="button" role="switch" class="switch" :aria-checked="model" :aria-label="label" :disabled="disabled" @click="model = !model">
            <span class="knob" />
        </button>
    </label>
</template>

<style scoped>
.toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
}
.toggle.disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
.toggle-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.toggle-label {
    font-weight: 500;
    font-size: 13.5px;
}
.toggle-desc {
    color: var(--text-dim);
    font-size: 12.5px;
}
.switch {
    width: 38px;
    height: 22px;
    border-radius: 99px;
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    position: relative;
    transition:
        background 0.18s var(--ease),
        border-color 0.18s var(--ease);
    flex-shrink: 0;
    padding: 0;
}
.knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-muted);
    transition:
        transform 0.18s var(--ease),
        background 0.18s;
}
.switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
}
.switch[aria-checked="true"] .knob {
    transform: translateX(16px);
    background: var(--accent-ink);
}
</style>
