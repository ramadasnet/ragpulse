<script setup lang="ts">
import DOMPurify from "dompurify"
import {marked} from "marked"

const props = defineProps<{source: string}>()

const html = computed(() => {
    const raw = marked.parse(props.source || "", {async: false, gfm: true}) as string
    return DOMPurify.sanitize(raw, {USE_PROFILES: {html: true}}).replace(/<a\s(?![^>]*\btarget=)/g, '<a target="_blank" rel="noopener noreferrer" ')
})
</script>

<template>
    <!-- eslint-disable-next-line vue/no-v-html -- sanitized with DOMPurify -->
    <div class="prose" v-html="html" />
</template>
