<script setup lang="ts">
import {ArrowUp} from "lucide-vue-next"

const props = withDefaults(
    defineProps<{
        placeholder?: string
        disabled?: boolean
        busy?: boolean
        max?: number
        hint?: string
    }>(),
    {max: 2000}
)
const emit = defineEmits<{send: [content: string]}>()
const text = defineModel<string>({default: ""})

const el = ref<HTMLTextAreaElement | null>(null)
const canSend = computed(() => !props.disabled && !props.busy && !!text.value.trim())
const showCounter = computed(() => text.value.length > props.max * 0.85)

function resize() {
    const t = el.value
    if (!t) return
    t.style.height = "auto"
    t.style.height = `${Math.min(t.scrollHeight, 150)}px`
}
watch(text, () => nextTick(resize))

function submit() {
    if (!canSend.value) return
    emit("send", text.value.trim())
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        submit()
    }
}

defineExpose({focus: () => el.value?.focus()})
</script>

<template>
    <form class="composer" :class="{disabled}" @submit.prevent="submit">
        <label class="sr-only" for="rp-input">Your message</label>
        <textarea id="rp-input" ref="el" v-model="text" rows="1" :maxlength="max" :placeholder="placeholder" :disabled="disabled" enterkeyhint="send" autocomplete="off" @keydown="onKeydown" />
        <div class="side">
            <span v-if="showCounter" class="counter" :class="{full: text.length >= max}">{{ text.length }}/{{ max }}</span>
            <button type="submit" class="send" :disabled="!canSend" :aria-label="busy ? 'Waiting for reply' : 'Send message'">
                <span v-if="busy" class="spin" aria-hidden="true" />
                <ArrowUp v-else :size="18" :stroke-width="2.4" />
            </button>
        </div>
    </form>
    <p v-if="hint" class="hint">{{ hint }}</p>
</template>

<style scoped>
.composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 6px 6px 6px 14px;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--c-r-composer);
    box-shadow: var(--c-shadow);
    backdrop-filter: var(--c-blur, none);
    transition:
        border-color 0.15s,
        box-shadow 0.15s;
}
.composer:focus-within {
    border-color: var(--c-highlight);
    box-shadow: var(--c-ring);
}
.composer.disabled {
    opacity: 0.6;
}
textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--c-text);
    font-size: 15px;
    line-height: 1.45;
    padding: 8px 0;
    max-height: 150px;
    min-height: 38px;
}
textarea::placeholder {
    color: var(--c-dim);
}
textarea:focus-visible {
    border-radius: 6px;
    box-shadow: none;
}
@media (pointer: coarse) {
    textarea {
        font-size: 16px;
    }
}
@container (max-height: 240px) {
    textarea {
        max-height: max(38px, 25cqh);
    }
}
.side {
    display: flex;
    align-items: center;
    gap: 8px;
}
.counter {
    font-size: 11px;
    color: var(--c-dim);
    font-variant-numeric: tabular-nums;
}
.counter.full {
    color: #f87171;
}
.send {
    width: 38px;
    height: 38px;
    border-radius: var(--c-r-icon);
    border: 0;
    display: grid;
    place-items: center;
    background: var(--c-accent);
    color: var(--c-accent-ink);
    transition:
        transform 0.12s var(--ease),
        opacity 0.15s;
}
.send:hover:not(:disabled) {
    transform: translateY(-1px);
}
.send:active:not(:disabled) {
    transform: scale(0.94);
}
.send:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}
.spin {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: rp-spin 0.7s linear infinite;
}
@keyframes rp-spin {
    to {
        transform: rotate(360deg);
    }
}
.hint {
    margin: 6px 4px 0;
    font-size: 11.5px;
    color: var(--c-dim);
    text-align: center;
}
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
}
@media (prefers-reduced-motion: reduce) {
    .spin {
        animation-duration: 2s;
    }
}
</style>
