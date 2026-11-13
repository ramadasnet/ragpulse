<script lang="ts">
type Renderer = (markdown: string) => string
let rendererPromise: Promise<Renderer> | null = null

/** Lazily loads marked + DOMPurify once for all instances. */
function loadRenderer(): Promise<Renderer> {
    rendererPromise ??= Promise.all([import("marked"), import("dompurify")]).then(([{marked}, {default: DOMPurify}]) => {
        DOMPurify.addHook("afterSanitizeAttributes", (node) => {
            if (node.tagName === "A") {
                node.setAttribute("target", "_blank")
                node.setAttribute("rel", "noopener noreferrer nofollow")
            }
        })
        return (markdown: string) => DOMPurify.sanitize(marked.parse(markdown, {async: false, gfm: true, breaks: true}))
    })
    return rendererPromise
}
</script>

<script setup lang="ts">
const props = defineProps<{content: string}>()
const html = ref<string | null>(null)

watch(
    () => props.content,
    async (content) => {
        const render = await loadRenderer()
        html.value = render(content || "")
    },
    {immediate: true}
)
</script>

<template>
    <div v-if="html !== null" class="prose" v-html="html" />
    <div v-else class="prose pre-wrap">{{ content }}</div>
</template>
