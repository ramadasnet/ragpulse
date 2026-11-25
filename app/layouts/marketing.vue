<script setup lang="ts">
import {repositoryUrl} from "#shared/marketing"
</script>

<template>
    <div class="comparison-shell">
        <header class="comparison-header">
            <div class="comparison-inner">
                <NuxtLink :to="{name: 'landing'}" aria-label="RAGPulse home"><AppLogo /></NuxtLink>
            </div>
        </header>
        <slot />
        <footer class="comparison-footer">
            <div class="comparison-inner">
                <p>Self-hosted AI support chat by <a href="https://ramadas.net">Ramadas.net</a></p>
                <nav aria-label="Project links">
                    <NuxtLink :to="{name: 'landing'}">RAGPulse home</NuxtLink>
                    <a :href="repositoryUrl">GitHub</a>
                </nav>
            </div>
        </footer>
    </div>
</template>

<style>
body:has(.comparison-shell) > div[data-ragpulse] {
    display: none;
}

.comparison-shell {
    --compare-width: 1060px;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
}
.comparison-inner,
.compare-main {
    width: min(100%, var(--compare-width));
    margin-inline: auto;
    padding-inline: clamp(16px, 4vw, 40px);
}
.comparison-header {
    border-bottom: 1px solid var(--border);
}
.comparison-header .comparison-inner,
.comparison-footer .comparison-inner {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px 24px;
    padding-block: 14px;
}
.comparison-footer nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
}
.comparison-header a,
.comparison-footer a {
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    min-height: 44px;
}
.comparison-header a:hover,
.comparison-footer a:hover {
    color: var(--accent);
}
.comparison-footer {
    margin-top: auto;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
}
.compare-main {
    padding-block: clamp(24px, 6vw, 64px);
}
.compare-main h1 {
    margin: 0;
    font-size: clamp(2rem, 6vw, 3.75rem);
    line-height: 1.08;
    letter-spacing: -0.035em;
    text-wrap: balance;
}
.compare-main h2 {
    margin: 0 0 14px;
    font-size: clamp(1.25rem, 3vw, 1.65rem);
    line-height: 1.2;
}
.compare-lede {
    max-width: 62ch;
    margin-top: 16px;
    color: var(--text-muted);
    font-size: clamp(1rem, 2vw, 1.15rem);
}
.compare-eyebrow {
    margin: 0 0 10px;
    font: 600 0.75rem/1.5 var(--font-mono);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.compare-crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 9px;
    padding: 0;
    margin: 0 0 24px;
    list-style: none;
    color: var(--text-muted);
}
.compare-crumbs li:not(:first-child)::before {
    content: "/";
    margin-inline-end: 9px;
}
.compare-crumbs a,
.compare-text-link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.2em;
}
.compare-crumbs a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
}
.compare-section {
    margin-top: clamp(32px, 6vw, 56px);
}
</style>
