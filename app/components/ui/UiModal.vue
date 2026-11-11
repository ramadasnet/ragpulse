<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
withDefaults(defineProps<{ title?: string, description?: string, width?: string }>(), { width: '520px' })

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @mousedown.self="open = false">
        <div class="modal panel" role="dialog" aria-modal="true" :aria-label="title" :style="{ maxWidth: width }">
          <header v-if="title" class="modal-head">
            <div class="stack" style="--gap: 4px">
              <h2>{{ title }}</h2>
              <p v-if="description" class="muted small">{{ description }}</p>
            </div>
            <button class="modal-close" aria-label="Close" @click="open = false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>
          <div class="modal-body"><slot /></div>
          <footer v-if="$slots.footer" class="modal-foot"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; z-index: 100; background: rgb(4 5 8 / 0.7); backdrop-filter: blur(4px); display: grid; place-items: center; padding: 16px; overflow-y: auto; }
.modal { width: 100%; box-shadow: var(--shadow-lg); background: var(--bg-elev); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 18px 20px 0; }
.modal-close { background: none; border: 0; color: var(--text-dim); padding: 4px; border-radius: 6px; }
.modal-close:hover { color: var(--text); background: var(--surface-2); }
.modal-body { padding: 18px 20px 20px; overflow-y: auto; }
.modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.18s var(--ease); }
.modal-enter-active .modal, .modal-leave-active .modal { transition: transform 0.18s var(--ease); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal, .modal-leave-to .modal { transform: translateY(8px) scale(0.98); }
</style>
