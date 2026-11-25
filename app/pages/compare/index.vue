<script setup lang="ts">
import {ArrowUpRight} from "lucide-vue-next"
import {comparisonHub, comparisonPath, comparisons, mcpDocumentationUrl, mcpSupport} from "#shared/marketing"
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
            <p class="compare-lede">
                RAGPulse gives you a self-hosted support inbox and lets your own agent connect it to other tools through MCP. A managed platform is often simpler if you want ready-made connectors, more visitor channels, or an agent your support team
                can configure without code.
            </p>
            <a class="compare-text-link mcp-jump" :href="`#${mcpSupport.id}`">See what your agent can do with MCP</a>
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

        <section :id="mcpSupport.id" class="compare-section mcp-guide" aria-labelledby="mcp-heading">
            <p class="compare-eyebrow">Integration approach</p>
            <h2 id="mcp-heading">{{ mcpSupport.title }}</h2>
            <p class="mcp-copy">{{ mcpSupport.summary }}</p>
            <p class="mcp-copy">{{ mcpSupport.setup }}</p>
            <div class="mcp-example panel">
                <h3>Example: triage a support escalation</h3>
                <ol>
                    <li v-for="step in mcpSupport.example" :key="step">{{ step }}</li>
                </ol>
            </div>
            <h3 class="mcp-tools-heading">What the MCP server exposes</h3>
            <dl class="mcp-tools">
                <div v-for="{area, names, detail} in mcpSupport.tools" :key="area">
                    <dt>{{ area }}</dt>
                    <dd>{{ detail }}</dd>
                    <dd class="mcp-tool-names">
                        <code v-for="name in names" :key="name">{{ name }}</code>
                    </dd>
                </div>
            </dl>
            <p class="mcp-copy">{{ mcpSupport.prompt }}</p>
            <a class="compare-text-link mcp-jump" :href="mcpDocumentationUrl">Read the MCP setup guide <ArrowUpRight :size="16" aria-hidden="true" /></a>
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
.mcp-jump {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
}
.mcp-guide {
    border-top: 1px solid var(--border);
    padding-top: 32px;
}
.mcp-copy {
    max-width: 72ch;
    color: var(--text-muted);
    margin-block: 12px;
    font-size: 1rem;
}
.mcp-example {
    border-inline-start: 3px solid var(--accent);
    margin-block: 24px;
    padding: clamp(16px, 4vw, 24px);
}
.mcp-example h3,
.mcp-tools-heading {
    margin: 0 0 12px;
    font-size: 1.125rem;
}
.mcp-example ol {
    display: grid;
    gap: 10px;
    margin: 0;
    padding-inline-start: 24px;
    color: var(--text-muted);
}
.mcp-example li::marker {
    color: var(--accent);
    font-weight: 700;
}
.mcp-tools {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr));
    gap: 12px;
    margin: 0;
}
.mcp-tools > div {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
}
.mcp-tools dt {
    color: var(--text);
    font-weight: 700;
}
.mcp-tools dd {
    margin: 4px 0 0;
    color: var(--text-muted);
}
.mcp-tool-names {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
}
.mcp-tool-names code {
    color: var(--accent);
    font: 0.75rem/1.6 var(--font-mono);
    overflow-wrap: anywhere;
}
</style>
