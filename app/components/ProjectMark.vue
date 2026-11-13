<script setup lang="ts">
defineProps<{title?: string | null; icon?: string | null}>()
</script>

<template>
    <img v-if="icon" :src="icon" alt="" class="mark-img" />
    <span v-else>{{ projectMark(title) }}</span>
</template>

<style scoped>
.mark-img {
    object-fit: contain;
    background: #fff;
    padding: 2px;
}
</style>
