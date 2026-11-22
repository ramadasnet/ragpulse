<script setup lang="ts">
import {Check, ChevronDown} from "lucide-vue-next"
import {AI_PROVIDERS, type AiProviderId, type AiProviderInfo} from "#shared/utils/ai-providers"

// Picks the AI provider shown on Global Settings, with the enabled ones marked (same look as the model picker)
const provider = defineModel<AiProviderId>({required: true})
/** `status`: the badge of a provider (e.g. Enabled), none when it isn't set up */
const props = defineProps<{label?: string; hint?: string; error?: string; status: (id: AiProviderId) => {tone: "success" | "danger" | "neutral"; label: string} | undefined}>()

const open = ref(false)
const active = ref(0)
const root = ref<HTMLElement>()
const triggerEl = ref<HTMLElement>()
const popEl = ref<HTMLElement>()
const popStyle = ref<Record<string, string>>({})
const uid = useId()

const selected = computed(() => AI_PROVIDERS.find((p) => p.id === provider.value)!)

/** What a provider offers, shown under its name */
function capabilities(p: AiProviderInfo) {
    if (p.id === "custom") return "Any OpenAI-compatible endpoint"
    return p.embeddings ? "Chat and embedding models" : "Chat models only, no embeddings"
}

function place() {
    const t = triggerEl.value
    if (!t || !open.value) return
    const r = t.getBoundingClientRect()
    const gap = 6
    const edge = 8
    const height = popEl.value?.offsetHeight ?? 480
    const below = window.innerHeight - r.bottom - gap - edge
    const above = r.top - gap - edge
    const up = below < height && above > below
    const width = Math.min(r.width, window.innerWidth - edge * 2)
    popStyle.value = {
        top: up ? "auto" : `${r.bottom + gap}px`,
        bottom: up ? `${window.innerHeight - r.top + gap}px` : "auto",
        left: `${Math.min(Math.max(edge, r.left), window.innerWidth - edge - width)}px`,
        width: `${width}px`,
        "--list-max": `${Math.max(140, Math.min(480, (up ? above : below) - 8))}px`
    }
}

function toggle() {
    open.value = !open.value
    if (!open.value) return
    active.value = Math.max(0, AI_PROVIDERS.indexOf(selected.value))
    place()
    nextTick(() => {
        place()
        popEl.value?.focus()
    })
}

function choose(id: AiProviderId) {
    provider.value = id
    open.value = false
    triggerEl.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const total = AI_PROVIDERS.length
        active.value = (active.value + (e.key === "ArrowDown" ? 1 : -1) + total) % total
    } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        choose(AI_PROVIDERS[active.value]!.id)
    } else if (e.key === "Escape" || e.key === "Tab") {
        e.stopPropagation()
        open.value = false
    }
}

watch(open, (isOpen) => {
    if (isOpen) {
        window.addEventListener("scroll", place, {capture: true, passive: true})
        window.addEventListener("resize", place)
    } else {
        window.removeEventListener("scroll", place, true)
        window.removeEventListener("resize", place)
    }
})

function onOutside(e: MouseEvent) {
    const target = e.target as Node
    if (open.value && !root.value?.contains(target) && !popEl.value?.contains(target)) open.value = false
}
onMounted(() => document.addEventListener("mousedown", onOutside))
onBeforeUnmount(() => {
    document.removeEventListener("mousedown", onOutside)
    window.removeEventListener("scroll", place, true)
    window.removeEventListener("resize", place)
})
</script>

<template>
    <UiField :label="label" :hint="hint" :error="error" :for="uid">
        <div ref="root" class="picker">
            <button :id="uid" ref="triggerEl" type="button" class="control trigger" :class="{invalid: !!error}" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
                <span class="grow trigger-text">
                    <span class="truncate strong">{{ selected.name }}</span>
                    <span class="truncate dim tiny">{{ capabilities(selected) }}</span>
                </span>
                <UiBadge v-if="props.status(selected.id)" :tone="props.status(selected.id)!.tone">{{ props.status(selected.id)!.label }}</UiBadge>
                <ChevronDown :size="15" class="dim" />
            </button>

            <Teleport to="body">
                <div v-if="open" ref="popEl" class="pop panel fade-in" :style="popStyle" role="listbox" tabindex="-1" :aria-activedescendant="`${uid}-${active}`" @keydown="onKeydown">
                    <button
                        v-for="(p, i) in AI_PROVIDERS"
                        :id="`${uid}-${i}`"
                        :key="p.id"
                        type="button"
                        role="option"
                        tabindex="-1"
                        class="option"
                        :aria-selected="p.id === provider"
                        :class="{active: i === active}"
                        @mouseenter="active = i"
                        @click="choose(p.id)"
                    >
                        <span class="opt-main">
                            <span class="row" style="--gap: 6px">
                                <span class="truncate">{{ p.name }}</span>
                                <Check v-if="p.id === provider" :size="14" class="accent" />
                            </span>
                            <span class="truncate tiny dim">{{ capabilities(p) }}</span>
                        </span>
                        <UiBadge v-if="props.status(p.id)" :tone="props.status(p.id)!.tone">{{ props.status(p.id)!.label }}</UiBadge>
                        <span v-else class="tiny dim nowrap">Not set up</span>
                    </button>
                </div>
            </Teleport>
        </div>
    </UiField>
</template>

<style scoped>
.picker {
    position: relative;
}
.trigger {
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    min-height: 48px;
    padding: 6px 12px;
    cursor: pointer;
}
.trigger-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
}
.pop {
    position: fixed;
    z-index: 60;
    box-shadow: var(--shadow-lg);
    background: var(--bg-elev);
    max-height: var(--list-max, 480px);
    overflow-y: auto;
    padding: 4px;
    outline: none;
}
.option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    width: 100%;
    background: none;
    border: 0;
    padding: 7px 8px;
    border-radius: 8px;
    text-align: left;
}
.option.active {
    background: var(--surface-2);
}
.option[aria-selected="true"] {
    background: var(--accent-soft);
}
.opt-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.35;
}
</style>
