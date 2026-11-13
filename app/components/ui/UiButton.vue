<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle"
        size?: "sm" | "md" | "lg"
        to?: string
        href?: string
        type?: "button" | "submit" | "reset"
        loading?: boolean
        disabled?: boolean
        block?: boolean
        icon?: boolean
    }>(),
    {variant: "secondary", size: "md", type: "button"}
)

const tag = computed(() => (props.to ? resolveComponent("NuxtLink") : props.href ? "a" : "button"))
</script>

<template>
    <component
        :is="tag"
        :to="to"
        :href="href"
        :type="to || href ? undefined : type"
        :disabled="to || href ? undefined : disabled || loading"
        :aria-busy="loading || undefined"
        class="btn"
        :class="[`btn-${variant}`, `btn-${size}`, {'btn-block': block, 'btn-icon': icon, 'is-loading': loading}]"
    >
        <span v-if="loading" class="btn-spinner" aria-hidden="true" />
        <slot />
    </component>
</template>

<style scoped>
.btn {
    --h: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: var(--h);
    padding: 0 14px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    font-weight: 500;
    font-size: 13.5px;
    white-space: nowrap;
    transition:
        background 0.15s var(--ease),
        border-color 0.15s var(--ease),
        color 0.15s var(--ease),
        transform 0.06s var(--ease),
        opacity 0.15s;
    user-select: none;
    position: relative;
}
.btn:active:not(:disabled) {
    transform: translateY(1px);
}
.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.btn-sm {
    --h: 30px;
    padding: 0 10px;
    font-size: 12.5px;
    border-radius: 8px;
    gap: 6px;
}
.btn-lg {
    --h: 44px;
    padding: 0 20px;
    font-size: 14.5px;
}
.btn-block {
    width: 100%;
}
.btn-icon {
    width: var(--h);
    padding: 0;
}

.btn-primary {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
}
.btn-primary:hover:not(:disabled) {
    background: var(--accent-strong);
}
.btn-secondary {
    background: var(--surface-2);
    border-color: var(--border-strong);
    color: var(--text);
}
.btn-secondary:hover:not(:disabled) {
    background: var(--surface-3);
    border-color: #3a4150;
}
.btn-ghost {
    background: transparent;
    color: var(--text-muted);
}
.btn-ghost:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
}
.btn-subtle {
    background: var(--accent-soft);
    color: var(--accent);
}
.btn-subtle:hover:not(:disabled) {
    background: rgb(163 255 122 / 0.2);
}
.btn-danger {
    background: var(--danger-soft);
    color: var(--danger);
    border-color: rgb(255 107 107 / 0.25);
}
.btn-danger:hover:not(:disabled) {
    background: rgb(255 107 107 / 0.2);
}

.is-loading {
    color: transparent !important;
}
.is-loading > :not(.btn-spinner) {
    visibility: hidden;
}
.btn-spinner {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
    color: var(--text);
}
.btn-primary .btn-spinner {
    color: var(--accent-ink);
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
