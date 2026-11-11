<script setup lang="ts">
defineProps<{ label: string, value: string | number, hint?: string, tone?: 'accent' | 'warning' | 'danger' }>()
</script>

<template>
  <div class="panel stat">
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value" :class="tone">{{ value }}</span>
    <span v-if="hint" class="stat-hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.stat { padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
.stat-value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.stat-value.accent { color: var(--accent); }
.stat-value.warning { color: var(--warning); }
.stat-value.danger { color: var(--danger); }
.stat-hint { font-size: 12px; color: var(--text-muted); }
</style>
