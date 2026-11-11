<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const model = defineModel<string | number | null | undefined>()
defineProps<{
  label?: string
  hint?: string
  error?: string
  optional?: boolean
  options: Array<{ value: string | number, label: string, disabled?: boolean }>
}>()
const uid = useId()
</script>

<template>
  <UiField :label="label" :hint="hint" :error="error" :optional="optional" :for="uid">
    <select :id="uid" v-model="model" v-bind="$attrs" class="control">
      <option v-for="o in options" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</option>
    </select>
  </UiField>
</template>
