<script setup lang="ts">
import {ArrowUpRight} from "lucide-vue-next"
import {comparisonHub, comparisonPath, comparisons} from "../../../shared/marketing"
import {marketingBreadcrumbs, useMarketingSeo} from "../../composables/useMarketingSeo"

definePageMeta({layout: "marketing"})

useMarketingSeo(comparisonHub, [marketingBreadcrumbs({path: comparisonHub.path, name: "Compare"})])
</script>

<template>
    <main class="compare-main">
        <nav aria-label="Breadcrumb">
            <ol class="compare-crumbs">
                <li><NuxtLink :to="{name: 'landing'}">Home</NuxtLink></li>
                <li aria-current="page">Compare</li>
            </ol>
        </nav>
        <header>
            <p class="compare-eyebrow">Support software buyer’s guide</p>
            <h1>Compare RAGPulse with other AI support tools</h1>
            <p class="compare-lede">Choose RAGPulse if you want to host your own support chat and answer from technical documentation. A managed tool may be a better fit if you need an existing helpdesk, more channels, or a no-code setup.</p>
        </header>

        <section class="compare-section" aria-labelledby="guides">
            <h2 id="guides">Side-by-side comparisons</h2>
            <ul class="comparison-list">
                <li v-for="(item, index) in comparisons" :key="item.slug">
                    <NuxtLink :to="comparisonPath(item.slug)" class="comparison-item">
                        <span class="comparison-index" aria-hidden="true">{{ String(index + 1).padStart(2, "0") }}</span>
                        <span>
                            <strong>RAGPulse vs {{ item.name }}</strong>
                            <span class="comparison-category">{{ item.category }}</span>
                        </span>
                        <ArrowUpRight :size="18" aria-hidden="true" />
                    </NuxtLink>
                </li>
            </ul>
        </section>
    </main>
</template>

<style scoped>
.comparison-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    gap: 10px;
    list-style: none;
    margin: 0;
    padding: 0;
}
.comparison-item {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.comparison-item:hover {
    border-color: var(--accent);
    background: var(--surface-2);
}
.comparison-item svg,
.comparison-index {
    color: var(--accent);
}
.comparison-index {
    font-family: var(--font-mono);
}
.comparison-category {
    display: block;
    color: var(--text-muted);
    font-size: 0.875rem;
}
</style>
