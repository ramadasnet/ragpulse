<script setup lang="ts">
defineProps<{label?: string; hint?: string; error?: string; for?: string; optional?: boolean}>()
</script>

<template>
    <div class="field">
        <label v-if="label || $slots.aside" class="field-label" :for="$props.for">
            <span>{{ label }} <span v-if="optional" class="dim small">(optional)</span></span>
            <slot name="aside" />
        </label>
        <slot />
        <p v-if="error" class="field-error">{{ error }}</p>
        <p v-else-if="hint" class="field-hint">{{ hint }}</p>
    </div>
</template>
