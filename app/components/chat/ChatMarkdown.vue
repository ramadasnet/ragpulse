<script lang="ts">
type Renderer = (markdown: string) => string

let rendererPromise: Promise<Renderer> | null = null

/** Lazily loads marked + DOMPurify (client only) and returns a sanitizing markdown renderer. */
function loadRenderer(): Promise<Renderer> {
    rendererPromise ??= Promise.all([import("marked"), import("dompurify")]).then(([{marked}, purifyModule]) => {
        const purify = purifyModule.default
        purify.addHook("afterSanitizeAttributes", (node) => {
            if (node.tagName === "A") {
                node.setAttribute("target", "_blank")
                node.setAttribute("rel", "noopener noreferrer nofollow")
            }
        })
        return (markdown: string) =>
            purify.sanitize(marked.parse(markdown, {async: false, gfm: true, breaks: true}), {
                FORBID_TAGS: ["style", "img", "iframe", "form", "input", "button", "video", "audio"],
                FORBID_ATTR: ["style"]
            })
    })
    return rendererPromise
}
</script>

<script setup lang="ts">
const props = defineProps<{content: string; streaming?: boolean}>()

const render = shallowRef<Renderer | null>(null)
const html = computed(() => (render.value ? render.value(props.content) : null))

onMounted(() => {
    loadRenderer()
        .then((r) => {
            render.value = r
        })
        .catch(() => {})
})
</script>

<template>
    <div v-if="html !== null" class="md" :class="{streaming}" v-html="html" />
    <div v-else class="md plain" :class="{streaming}">
        <p>{{ content }}</p>
    </div>
</template>

<style scoped>
.md {
    line-height: 1.6;
    overflow-wrap: anywhere;
}
.md.plain p {
    white-space: pre-wrap;
    margin: 0;
}
.md :deep(> :first-child) {
    margin-top: 0;
}
.md :deep(> :last-child) {
    margin-bottom: 0;
}
.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(pre),
.md :deep(blockquote),
.md :deep(table) {
    margin: 0 0 0.65em;
}
.md :deep(ul),
.md :deep(ol) {
    padding-left: 1.25em;
}
.md :deep(li + li) {
    margin-top: 0.2em;
}
.md :deep(li::marker) {
    color: var(--c-dim);
}
.md :deep(a) {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: var(--c-accent2);
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
}
.md :deep(a:hover) {
    color: var(--c-accent2);
}
.md :deep(strong) {
    font-weight: 650;
}
.md :deep(code) {
    font-family: var(--font-mono);
    font-size: 0.88em;
    background: var(--c-surface-2);
    padding: 0.1em 0.35em;
    border-radius: var(--c-r-xs);
}
.md :deep(pre) {
    background: var(--c-surface-2);
    padding: 10px 12px;
    border-radius: var(--c-r-field);
    overflow-x: auto;
}
.md :deep(pre code) {
    background: none;
    padding: 0;
}
.md :deep(blockquote) {
    border-left: 3px solid var(--c-highlight);
    padding-left: 10px;
    color: var(--c-muted);
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
    font-size: 1em;
    margin: 0.8em 0 0.35em;
}
.md :deep(table) {
    border-collapse: collapse;
    display: block;
    overflow-x: auto;
    font-size: 0.94em;
}
.md :deep(th),
.md :deep(td) {
    border: 1px solid var(--c-border);
    padding: 4px 8px;
}
.md :deep(hr) {
    border: 0;
    border-top: 1px solid var(--c-border);
    margin: 0.8em 0;
}

.streaming :deep(> :last-child)::after,
.streaming.plain p::after {
    content: "";
    display: inline-block;
    width: 0.45em;
    height: 1.05em;
    margin-left: 3px;
    vertical-align: -0.18em;
    border-radius: 2px;
    background: var(--c-highlight);
    animation: rp-caret 1s steps(2, start) infinite;
}
@keyframes rp-caret {
    to {
        visibility: hidden;
    }
}
@media (prefers-reduced-motion: reduce) {
    .streaming :deep(> :last-child)::after,
    .streaming.plain p::after {
        animation: none;
    }
}
</style>
