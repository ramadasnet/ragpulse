<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'info' | 'violet' }>(), { tone: 'neutral' })
</script>

<template>
  <span class="badge" :class="`badge-${tone}`"><slot /></span>
</template>

<style scoped>
.badge { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 99px; font-size: 11.5px; font-weight: 500; white-space: nowrap; border: 1px solid transparent; }
.badge-neutral { background: var(--surface-2); color: var(--text-muted); border-color: var(--border); }
.badge-success { background: var(--success-soft); color: var(--success); }
.badge-warning { background: var(--warning-soft); color: var(--warning); }
.badge-danger { background: var(--danger-soft); color: var(--danger); }
.badge-accent { background: var(--accent-soft); color: var(--accent); }
.badge-info { background: var(--info-soft); color: var(--info); }
.badge-violet { background: var(--violet-soft); color: var(--violet); }
</style>
