<script setup lang="ts">
defineOptions({inheritAttrs: false})
const model = defineModel<string | number | null | undefined>()
withDefaults(defineProps<{label?: string; hint?: string; error?: string; type?: string; optional?: boolean; id?: string}>(), {type: "text"})
const uid = useId()
</script>

<template>
    <UiField :label="label" :hint="hint" :error="error" :optional="optional" :for="id || uid">
        <template v-if="$slots.aside" #aside><slot name="aside" /></template>
        <input :id="id || uid" v-model="model" v-bind="$attrs" :type="type" class="control" :class="{invalid: !!error}" />
    </UiField>
</template>
