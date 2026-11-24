<script setup lang="ts">
import {ArrowUpRight, Check} from "lucide-vue-next"
import {comparisonHub, comparisonPath, comparisonRows, comparisons, documentationUrl} from "#shared/marketing"
import {marketingBreadcrumbs, useMarketingSeo} from "../../composables/useMarketingSeo"

definePageMeta({
    layout: "marketing",
    key: (route) => route.path
})

const {competitor} = useRoute().params
const comparison = comparisons.find(({slug}) => slug === competitor)
if (!comparison) throw createError({statusCode: 404, statusMessage: "Comparison not found"})

const path = comparisonPath(comparison.slug)
const otherComparisons = comparisons.filter(({slug}) => slug !== comparison.slug)
const reviewDate = new Intl.DateTimeFormat("en", {dateStyle: "long", timeZone: "UTC"}).format(new Date(comparison.reviewed))
useMarketingSeo({path, title: `RAGPulse vs ${comparison.name} | AI support comparison`, description: comparison.description}, [marketingBreadcrumbs({path: comparisonHub.path, name: "Compare"}, {path, name: comparison.name})])
</script>

<template>
    <main class="compare-main">
        <nav aria-label="Breadcrumb">
            <ol class="compare-crumbs">
                <li><NuxtLink :to="{name: 'landing'}">Home</NuxtLink></li>
                <li><NuxtLink :to="comparisonHub.path">Compare</NuxtLink></li>
                <li aria-current="page">{{ comparison.name }}</li>
            </ol>
        </nav>
        <article>
            <header>
                <p class="compare-eyebrow">{{ comparison.category }}</p>
                <h1>RAGPulse vs {{ comparison.name }}</h1>
                <p class="compare-lede">{{ comparison.verdict }}</p>
                <p class="reviewed">
                    Last reviewed <time :datetime="comparison.reviewed">{{ reviewDate }}</time>
                </p>
            </header>

            <section class="compare-section strengths panel" aria-labelledby="why-ragpulse">
                <h2 id="why-ragpulse">Why choose RAGPulse?</h2>
                <ul>
                    <li v-for="strength in comparison.strengths" :key="strength">
                        <Check :size="18" aria-hidden="true" /><span>{{ strength }}</span>
                    </li>
                </ul>
                <a class="compare-text-link" :href="documentationUrl">Read the self-hosting guide <ArrowUpRight :size="16" aria-hidden="true" /></a>
            </section>

            <section class="compare-section" aria-labelledby="features">
                <h2 id="features">Features at a glance</h2>
                <table class="feature-table" aria-labelledby="features">
                    <thead>
                        <tr>
                            <th scope="col">RAGPulse</th>
                            <th scope="col">{{ comparison.name }}</th>
                        </tr>
                    </thead>
                    <tbody v-for="({topic, ragpulse}, i) in comparisonRows" :key="topic">
                        <tr>
                            <th scope="rowgroup" colspan="2">{{ topic }}</th>
                        </tr>
                        <tr>
                            <td>{{ ragpulse }}</td>
                            <td>{{ comparison.cells[i] }}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="sources">
                    Sources: <a class="compare-text-link" :href="documentationUrl">RAGPulse documentation</a>
                    <template v-for="{label, url} in comparison.sources" :key="url">
                        · <a class="compare-text-link" :href="url">{{ label }}</a></template
                    >
                </p>
            </section>

            <section class="compare-section" aria-labelledby="better-fit">
                <h2 id="better-fit">When {{ comparison.name }} may be a better fit</h2>
                <p class="fit">{{ comparison.fit }}</p>
            </section>
        </article>

        <section class="compare-section related" aria-labelledby="related">
            <h2 id="related">Compare other support tools</h2>
            <ul>
                <li v-for="item in otherComparisons" :key="item.slug">
                    <NuxtLink :to="comparisonPath(item.slug)">RAGPulse vs {{ item.name }} <ArrowUpRight :size="14" aria-hidden="true" /></NuxtLink>
                </li>
            </ul>
        </section>
    </main>
</template>

<style scoped>
.reviewed,
.sources {
    margin-top: 12px;
    color: var(--text-muted);
}
.reviewed {
    font: 0.75rem/1.5 var(--font-mono);
}
.strengths {
    border-inline-start: 3px solid var(--accent);
    padding: clamp(16px, 4vw, 28px);
}
.strengths ul,
.related ul {
    list-style: none;
    padding: 0;
    margin: 0;
}
.strengths li {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
    color: var(--text-muted);
    font-size: 1rem;
}
.strengths li svg {
    color: var(--accent);
    flex: 0 0 auto;
    margin-top: 3px;
}
.strengths a,
.related a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    gap: 6px;
}
.feature-table {
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: 100%;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-align: left;
}
.feature-table th,
.feature-table td {
    padding: 10px clamp(10px, 3vw, 20px);
    vertical-align: top;
}
.feature-table thead th {
    background: var(--surface-2);
    font-size: 1rem;
}
.feature-table thead th:first-child {
    color: var(--accent);
}
.feature-table tbody th {
    background: var(--surface);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
}
.feature-table td {
    color: var(--text-muted);
}
.feature-table td + td {
    border-inline-start: 1px solid var(--border);
}
.fit {
    max-width: 70ch;
    font-size: 1rem;
    color: var(--text-muted);
}
.related {
    border-top: 1px solid var(--border);
    padding-top: 24px;
}
.related ul {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.related a {
    padding-inline: 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
}
.related a:hover {
    border-color: var(--accent);
    color: var(--accent);
}
</style>
