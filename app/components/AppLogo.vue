<template>
  <span class="logo">
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#161a21" />
      <!-- Document-shaped chat bubble (knowledge base) with an AI spark -->
      <path d="M9.5 5.5h10.5l6 6V18a4 4 0 0 1-4 4h-8l-5 4v-4.1A4 4 0 0 1 5.5 18V9.5a4 4 0 0 1 4-4z" fill="var(--accent)" />
      <path d="M20 5.5v4a2 2 0 0 0 2 2h4z" fill="var(--accent-ink)" fill-opacity=".4" />
      <path d="M10 11.5h6M10 15.5h3.5" stroke="var(--accent-ink)" stroke-width="2" stroke-linecap="round" />
      <path d="M20 11.5q.4 4.1 4.5 4.5q-4.1.4-4.5 4.5q-.4-4.1-4.5-4.5q4.1-.4 4.5-4.5z" fill="var(--accent-ink)" />
    </svg>
    <span class="logo-text">RAG<span>Pulse</span></span>
  </span>
</template>

<style scoped>
.logo { display: inline-flex; align-items: center; gap: 10px; }
.logo-text { font-weight: 700; letter-spacing: -0.02em; font-size: 16px; }
.logo-text span { color: var(--accent); }
</style>
