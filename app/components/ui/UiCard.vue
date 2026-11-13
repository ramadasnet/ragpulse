<script setup lang="ts">
withDefaults(defineProps<{title?: string; description?: string; pad?: boolean}>(), {pad: true})
</script>

<template>
    <section class="panel card">
        <header v-if="title || $slots.actions || $slots.header" class="card-head">
            <slot name="header">
                <div class="stack" style="--gap: 2px">
                    <h2 class="card-title">{{ title }}</h2>
                    <p v-if="description" class="muted small">{{ description }}</p>
                </div>
            </slot>
            <div v-if="$slots.actions" class="row"><slot name="actions" /></div>
        </header>
        <div :class="{'card-body': pad}"><slot /></div>
        <footer v-if="$slots.footer" class="card-foot"><slot name="footer" /></footer>
    </section>
</template>

<style scoped>
.card {
    overflow: hidden;
}
.card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
}
.card-title {
    font-size: 15px;
}
.card-body {
    padding: 20px;
}
.card-foot {
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
</style>
