<script setup lang="ts">
import {ArrowUpRight, CodeXml, FileText} from "lucide-vue-next"

type Kind = "docs" | "code"

const props = defineProps<{sources: NonNullable<ChatUiMessage["sources"]>}>()

const GROUPS = [
    {kind: "docs" as const, label: "References", icon: FileText},
    {kind: "code" as const, label: "Source code", icon: CodeXml}
]

const uid = useId()
const root = ref<HTMLElement | null>(null)
const open = ref<Kind | null>(null)
const pinned = ref(false)
const placement = ref<{down: boolean; shift: number}>({down: false, shift: 0})
let closeTimer: ReturnType<typeof setTimeout> | undefined

const groups = computed(() => GROUPS.map((g) => ({...g, items: props.sources.filter((s) => s.kind === g.kind)})).filter((g) => g.items.length))

/** Opens the overlay upwards when there is room in the chat scroller, and keeps it inside its width. */
function place(button: HTMLElement) {
    const rect = button.getBoundingClientRect()
    const scroller = button.closest(".rp-scroll")?.getBoundingClientRect() ?? {top: 0, left: 0, right: window.innerWidth}
    const width = Math.min(300, scroller.right - scroller.left - 16)
    placement.value = {
        down: rect.top - scroller.top < 220,
        shift: Math.max(0, scroller.left + 8 - (rect.right - width))
    }
}

function show(kind: Kind, button: HTMLElement, pin: boolean) {
    clearTimeout(closeTimer)
    if (open.value !== kind) place(button)
    open.value = kind
    pinned.value = pin
}

function close() {
    clearTimeout(closeTimer)
    open.value = null
    pinned.value = false
}

function onEnter(kind: Kind, e: PointerEvent) {
    if (e.pointerType !== "mouse" || (pinned.value && open.value !== kind)) return
    show(kind, (e.currentTarget as HTMLElement).querySelector("button")!, pinned.value)
}

function onLeave(e: PointerEvent) {
    if (e.pointerType !== "mouse" || pinned.value) return
    closeTimer = setTimeout(close, 150)
}

function onClick(kind: Kind, e: MouseEvent) {
    if (open.value === kind && pinned.value) close()
    else show(kind, e.currentTarget as HTMLElement, true)
}

function onOutside(e: PointerEvent) {
    if (open.value && !root.value?.contains(e.target as Node)) close()
}

function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !open.value) return
    e.stopPropagation()
    const kind = open.value
    close()
    root.value?.querySelector<HTMLElement>(`[data-kind="${kind}"]`)?.focus()
}

onMounted(() => document.addEventListener("pointerdown", onOutside))
onBeforeUnmount(() => {
    clearTimeout(closeTimer)
    document.removeEventListener("pointerdown", onOutside)
})
</script>

<template>
    <div ref="root" class="srcs" role="group" aria-label="Sources" @keydown="onKeydown">
        <div v-for="g in groups" :key="g.kind" class="grp" @pointerenter="onEnter(g.kind, $event)" @pointerleave="onLeave">
            <button
                type="button"
                class="src-btn"
                :class="{on: open === g.kind}"
                :data-kind="g.kind"
                :aria-expanded="open === g.kind"
                :aria-controls="`${uid}-${g.kind}`"
                :aria-label="`${g.label}: ${g.items.length} source${g.items.length === 1 ? '' : 's'}`"
                :title="g.label"
                @click="onClick(g.kind, $event)"
            >
                <component :is="g.icon" :size="14" aria-hidden="true" />
                <span class="count" aria-hidden="true">{{ g.items.length }}</span>
            </button>
            <div v-if="open === g.kind" :id="`${uid}-${g.kind}`" class="src-pop" :class="{down: placement.down}" :style="{right: `${-placement.shift}px`}">
                <p class="pop-title">{{ g.label }}</p>
                <ul class="pop-list">
                    <li v-for="(s, i) in g.items" :key="s.url || i">
                        <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer nofollow" class="pop-link" :title="s.url">
                            <span class="truncate">{{ s.title || s.url }}</span>
                            <ArrowUpRight :size="12" aria-hidden="true" />
                        </a>
                        <span v-else class="pop-link plain"
                            ><span class="truncate">{{ s.title }}</span></span
                        >
                    </li>
                </ul>
            </div>
        </div>
    </div>
</template>

<style scoped>
.srcs {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    margin: 6px -8px -6px 0;
}
.grp {
    position: relative;
}
.src-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 7px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--c-muted);
    font-size: 11.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    transition:
        background 0.15s,
        color 0.15s;
}
.src-btn:hover,
.src-btn.on {
    background: var(--c-highlight-soft);
    color: var(--c-text);
}
.src-btn svg {
    color: var(--c-highlight-ink);
}
.src-pop {
    position: absolute;
    bottom: calc(100% + 6px);
    z-index: 5;
    width: max-content;
    min-width: 180px;
    max-width: min(300px, calc(100vw - 48px));
    padding: 6px;
    border-radius: 12px;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    box-shadow: 0 10px 30px -8px rgb(0 0 0 / 0.35);
    animation: src-in 0.14s var(--ease) both;
}
.src-pop.down {
    bottom: auto;
    top: calc(100% + 6px);
}
/* Bridges the gap between the button and the overlay so hovering across it keeps the overlay open */
.src-pop::before {
    content: "";
    position: absolute;
    inset: 100% 0 auto;
    height: 8px;
}
.src-pop.down::before {
    inset: auto 0 100%;
}
.pop-title {
    margin: 2px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--c-dim);
}
.pop-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.pop-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 34px;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 13px;
    color: var(--c-text);
}
a.pop-link:hover {
    background: var(--c-surface-2);
}
.pop-link svg {
    flex-shrink: 0;
    color: var(--c-highlight-ink);
}
.pop-link.plain {
    color: var(--c-muted);
}
.truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
@keyframes src-in {
    from {
        opacity: 0;
        transform: translateY(3px);
    }
}
@media (prefers-reduced-motion: reduce) {
    .src-pop {
        animation: none;
    }
}
</style>
