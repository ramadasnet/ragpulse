<script setup lang="ts">
defineOptions({inheritAttrs: false})
const model = defineModel<string | number | null | undefined>()
// `secret`: API keys and tokens. A masked text field instead of a password field, so browsers and password managers
// don't offer to generate or save passwords for it.
withDefaults(defineProps<{label?: string; hint?: string; error?: string; type?: string; optional?: boolean; id?: string; secret?: boolean}>(), {type: "text"})
const uid = useId()
</script>

<template>
    <UiField :label="label" :hint="hint" :error="error" :optional="optional" :for="id || uid">
        <template v-if="$slots.aside" #aside><slot name="aside" /></template>
        <input
            v-if="secret"
            :id="id || uid"
            v-model="model"
            v-bind="$attrs"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            class="control secret"
            :class="{invalid: !!error}"
        />
        <input v-else :id="id || uid" v-model="model" v-bind="$attrs" :type="type" class="control" :class="{invalid: !!error}" />
    </UiField>
</template>

<style scoped>
.secret:not(:placeholder-shown) {
    -webkit-text-security: disc;
}
</style>
