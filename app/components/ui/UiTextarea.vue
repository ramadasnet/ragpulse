<script setup lang="ts">
defineOptions({inheritAttrs: false})
const model = defineModel<string | null | undefined>()
withDefaults(defineProps<{label?: string; hint?: string; error?: string; rows?: number; optional?: boolean; mono?: boolean}>(), {rows: 4})
const uid = useId()
</script>

<template>
    <UiField :label="label" :hint="hint" :error="error" :optional="optional" :for="uid">
        <template v-if="$slots.aside" #aside><slot name="aside" /></template>
        <textarea :id="uid" v-model="model" v-bind="$attrs" :rows="rows" class="control" :class="{invalid: !!error, mono}" />
    </UiField>
</template>
