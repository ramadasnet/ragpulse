<script lang="ts">
export interface ModelInfo {
    id: string
    name: string
    contextLength: number
    /** USD per 1M tokens */
    promptPrice: number
    completionPrice: number
}

export function formatModelPrice(usdPerMillion: number): string {
    if (!usdPerMillion) return "free"
    // OpenRouter reports -1 for routers whose price depends on the model they pick
    if (usdPerMillion < 0) return "variable"
    return usdPerMillion < 0.1 ? `$${usdPerMillion.toFixed(3)}` : `$${usdPerMillion.toFixed(2)}`
}

export function formatContext(tokens: number): string {
    if (!tokens) return "—"
    return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M` : `${Math.round(tokens / 1000)}K`
}
</script>

<script setup lang="ts">
import {Check, ChevronDown, Search} from "lucide-vue-next"

const model = defineModel<string>({default: ""})
// `defaultModel` adds a "Use the default model" option that sets the value to "" (the Global Settings default applies)
const props = defineProps<{label?: string; hint?: string; placeholder?: string; disabled?: boolean; kind?: "chat" | "embedding"; defaultModel?: string}>()

const isEmbedding = computed(() => props.kind === "embedding")
const models = useState<ModelInfo[] | null>(isEmbedding.value ? "openrouter-embedding-models" : "openrouter-models", () => null)
const loadError = ref("")
const loading = ref(false)
const open = ref(false)
const search = ref("")
const active = ref(0)
const root = ref<HTMLElement>()
const triggerEl = ref<HTMLElement>()
const popEl = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const listEl = ref<HTMLElement>()
const popStyle = ref<Record<string, string>>({})
const uid = useId()

async function load() {
    if (models.value || loading.value) return
    loading.value = true
    loadError.value = ""
    try {
        models.value = await $fetch<ModelInfo[]>("/api/models", {query: isEmbedding.value ? {type: "embedding"} : undefined})
    } catch (err) {
        loadError.value = errorMessage(err)
    } finally {
        loading.value = false
    }
}
onMounted(load)

/** The model shown: the chosen one, or the default model while none is chosen. */
const shown = computed(() => model.value || props.defaultModel || "")
const selected = computed(() => models.value?.find((m) => m.id === shown.value))
const usingDefault = computed(() => !!props.defaultModel && !model.value)

const filtered = computed(() => {
    const list = models.value ?? []
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = terms.length ? list.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t))) : list
    return matches.slice(0, 80)
})

const customId = computed(() => {
    const value = search.value.trim()
    return /^[\w.:/@~-]+$/.test(value) && !models.value?.some((m) => m.id === value) ? value : ""
})

const optionCount = computed(() => filtered.value.length + (customId.value ? 1 : 0))
/** Keyboard index of the first option: -1 is the "Use the default model" option, when shown */
const firstIndex = computed(() => (props.defaultModel ? -1 : 0))

watch(search, () => (active.value = 0))
watch(models, () => open.value && nextTick(place))

function place() {
    const t = triggerEl.value
    if (!t || !open.value) return
    const r = t.getBoundingClientRect()
    const gap = 6
    const edge = 8
    const height = popEl.value?.offsetHeight ?? 424
    const below = window.innerHeight - r.bottom - gap - edge
    const above = r.top - gap - edge
    const up = below < height && above > below
    const width = Math.min(r.width, window.innerWidth - edge * 2)
    popStyle.value = {
        top: up ? "auto" : `${r.bottom + gap}px`,
        bottom: up ? `${window.innerHeight - r.top + gap}px` : "auto",
        left: `${Math.min(Math.max(edge, r.left), window.innerWidth - edge - width)}px`,
        width: `${width}px`,
        "--list-max": `${Math.max(140, Math.min(320, (up ? above : below) - 104))}px`
    }
}

function toggle() {
    if (props.disabled) return
    open.value = !open.value
    if (open.value) {
        search.value = ""
        active.value = usingDefault.value
            ? -1
            : Math.max(
                  0,
                  filtered.value.findIndex((m) => m.id === model.value)
              )
        load()
        place()
        nextTick(() => {
            place()
            searchInput.value?.focus()
            scrollActive()
        })
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

function priceLabel(m: ModelInfo) {
    return isEmbedding.value ? formatModelPrice(m.promptPrice) : `${formatModelPrice(m.promptPrice)} / ${formatModelPrice(m.completionPrice)}`
}

function choose(id: string) {
    model.value = id
    open.value = false
}

function scrollActive() {
    nextTick(() => listEl.value?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)?.scrollIntoView({block: "nearest"}))
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const total = optionCount.value - firstIndex.value
        if (!total) return
        active.value = ((active.value - firstIndex.value + (e.key === "ArrowDown" ? 1 : -1) + total) % total) + firstIndex.value
        scrollActive()
    } else if (e.key === "Enter") {
        e.preventDefault()
        if (active.value === -1 && props.defaultModel) choose("")
        else if (customId.value && active.value === filtered.value.length) choose(customId.value)
        else if (filtered.value[active.value]) choose(filtered.value[active.value]!.id)
        else if (customId.value) choose(customId.value)
    } else if (e.key === "Escape") {
        e.stopPropagation()
        open.value = false
    }
}

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
    <UiField :label="label" :hint="hint" :for="uid">
        <div ref="root" class="picker">
            <button :id="uid" ref="triggerEl" type="button" class="control trigger" :disabled="disabled" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
                <span class="grow trigger-text">
                    <template v-if="shown">
                        <span class="truncate strong">{{ selected?.name || shown }}<span v-if="usingDefault" class="dim"> · default model</span></span>
                        <span class="truncate dim mono tiny">{{ shown }}</span>
                    </template>
                    <span v-else class="dim">{{ placeholder || "Select a model" }}</span>
                </span>
                <span v-if="selected" class="trigger-meta tiny muted nowrap">
                    {{ priceLabel(selected) }}
                </span>
                <ChevronDown :size="15" class="dim" />
            </button>

            <Teleport to="body">
                <div v-if="open" ref="popEl" class="pop panel fade-in" :style="popStyle" @keydown="onKeydown">
                    <div class="search">
                        <Search :size="15" class="dim" />
                        <input
                            ref="searchInput"
                            v-model="search"
                            class="search-input"
                            :placeholder="isEmbedding ? 'Search models, e.g. openai, qwen, voyage…' : 'Search models, e.g. claude, gpt-4o, llama…'"
                            aria-label="Search models"
                            role="combobox"
                            :aria-expanded="true"
                            :aria-controls="`${uid}-list`"
                        />
                    </div>
                    <div class="list-head tiny dim">
                        <span>Model</span>
                        <span class="nowrap">Context</span>
                        <span class="nowrap">{{ isEmbedding ? "Per 1M tokens" : "In / out per 1M" }}</span>
                    </div>
                    <div :id="`${uid}-list`" ref="listEl" class="list" role="listbox">
                        <button v-if="defaultModel" type="button" role="option" class="option default-option" data-index="-1" :aria-selected="usingDefault" :class="{active: active === -1}" @mouseenter="active = -1" @click="choose('')">
                            <span class="opt-main">
                                <span class="row" style="--gap: 6px">
                                    <span>Use the default model</span>
                                    <Check v-if="usingDefault" :size="14" class="accent" />
                                </span>
                                <span class="truncate mono tiny dim">{{ defaultModel }}</span>
                            </span>
                        </button>
                        <div v-if="loading" class="state"><UiSpinner :size="16" /> Loading models…</div>
                        <p v-else-if="loadError" class="state small">
                            <span class="danger-text">Could not load models.</span> <span class="dim">Type a model id (e.g. {{ isEmbedding ? "openai/text-embedding-3-small" : "openrouter/free" }}) to use it anyway.</span>
                        </p>
                        <button v-for="(m, i) in filtered" :key="m.id" type="button" role="option" class="option" :data-index="i" :aria-selected="m.id === model" :class="{active: i === active}" @mouseenter="active = i" @click="choose(m.id)">
                            <span class="opt-main">
                                <span class="row" style="--gap: 6px">
                                    <span class="truncate">{{ m.name }}</span>
                                    <Check v-if="m.id === model" :size="14" class="accent" />
                                </span>
                                <span class="truncate mono tiny dim">{{ m.id }}</span>
                            </span>
                            <span class="tiny muted nowrap">{{ formatContext(m.contextLength) }}</span>
                            <span class="tiny muted nowrap price">{{ priceLabel(m) }}</span>
                        </button>
                        <button
                            v-if="customId"
                            type="button"
                            role="option"
                            class="option"
                            :data-index="filtered.length"
                            :aria-selected="false"
                            :class="{active: active === filtered.length}"
                            @mouseenter="active = filtered.length"
                            @click="choose(customId)"
                        >
                            <span class="opt-main"
                                ><span>Use custom id</span><span class="mono tiny dim truncate">{{ customId }}</span></span
                            >
                        </button>
                        <p v-if="!loading && !loadError && !filtered.length && !customId" class="state small dim">No models match “{{ search }}”.</p>
                    </div>
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
.trigger-meta {
    font-variant-numeric: tabular-nums;
}
.pop {
    position: fixed;
    z-index: 60;
    box-shadow: var(--shadow-lg);
    background: var(--bg-elev);
    overflow: hidden;
}
.search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
}
.search-input {
    flex: 1;
    background: none;
    border: 0;
    outline: none;
    min-width: 0;
}
.search-input:focus-visible {
    box-shadow: none;
}
.list-head,
.option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 64px 120px;
    gap: 12px;
    align-items: center;
}
.list-head {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
.list-head span:not(:first-child),
.option > span:not(.opt-main) {
    text-align: right;
}
.list {
    max-height: var(--list-max, 320px);
    overflow-y: auto;
    padding: 4px;
}
.option {
    width: 100%;
    background: none;
    border: 0;
    padding: 7px 8px;
    border-radius: 8px;
    text-align: left;
}
.default-option {
    grid-template-columns: minmax(0, 1fr);
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
.price {
    font-variant-numeric: tabular-nums;
}
.state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 10px;
    flex-wrap: wrap;
}
@media (max-width: 560px) {
    .list-head,
    .option {
        grid-template-columns: minmax(0, 1fr) 96px;
    }
    .list-head span:nth-child(2),
    .option > span:nth-child(2) {
        display: none;
    }
    .trigger-meta {
        display: none;
    }
}
</style>
