<script setup lang="ts">
const {toasts, dismiss} = useToast()
</script>

<template>
    <div class="toaster" aria-live="polite">
        <TransitionGroup name="toast">
            <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tone" role="status" @click="dismiss(t.id)">
                <span class="dot" :class="t.tone === 'error' ? 'err' : t.tone === 'success' ? 'ok' : 'warn'" />
                <span>{{ t.message }}</span>
            </div>
        </TransitionGroup>
    </div>
</template>

<style scoped>
.toaster {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
}
.toast {
    pointer-events: auto;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 380px;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 10px 14px;
    box-shadow: var(--shadow-lg);
    font-size: 13.5px;
}
.toast-enter-active,
.toast-leave-active {
    transition: all 0.2s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>
