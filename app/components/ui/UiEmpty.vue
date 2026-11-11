<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ title: string, description?: string, icon?: Component }>()
</script>

<template>
  <div class="empty">
    <div v-if="icon" class="empty-icon"><component :is="icon" :size="20" /></div>
    <h3>{{ title }}</h3>
    <p v-if="description" class="muted">{{ description }}</p>
    <div v-if="$slots.default" class="row" style="margin-top: 8px"><slot /></div>
  </div>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 48px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); }
.empty p { max-width: 420px; }
.empty-icon { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); margin-bottom: 4px; }
</style>
