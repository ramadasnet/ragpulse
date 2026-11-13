<script setup lang="ts">
const {state, resolve} = useConfirm()
</script>

<template>
    <UiModal :open="state.open" :title="state.title" width="440px" @update:open="(v: boolean) => !v && resolve(false)">
        <p class="muted">{{ state.message }}</p>
        <template #footer>
            <UiButton variant="ghost" @click="resolve(false)">Cancel</UiButton>
            <UiButton :variant="state.danger ? 'danger' : 'primary'" @click="resolve(true)">{{ state.confirmLabel }}</UiButton>
        </template>
    </UiModal>
</template>
