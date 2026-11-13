<script setup lang="ts">
interface ActivityPoint {
    date: string
    sessions: number
    messages: number
    escalated: number
}

const props = defineProps<{data: ActivityPoint[]}>()

const W = 1000
const H = 240
const hover = ref<number | null>(null)

const max = computed(() => {
    const peak = Math.max(1, ...props.data.map((d) => Math.max(d.messages, d.sessions + d.escalated)))
    // Round up to a "nice" axis maximum
    const pow = 10 ** Math.floor(Math.log10(peak))
    const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= peak) ?? 10
    return step * pow
})

const slot = computed(() => W / Math.max(1, props.data.length))
const y = (v: number) => H - (v / max.value) * H

const bars = computed(() => {
    const bw = Math.max(2, slot.value * 0.56)
    return props.data.map((d, i) => {
        const x = i * slot.value + (slot.value - bw) / 2
        const sh = (d.sessions / max.value) * H
        const eh = (d.escalated / max.value) * H
        return {x, w: bw, sessionsY: H - sh, sessionsH: sh, escY: H - sh - eh, escH: eh}
    })
})

const messagesLine = computed(() => props.data.map((d, i) => `${(i + 0.5) * slot.value},${y(d.messages)}`).join(" "))
const messagesArea = computed(() => {
    if (!props.data.length) return ""
    const first = 0.5 * slot.value
    const last = (props.data.length - 0.5) * slot.value
    return `M${first},${H} L${messagesLine.value.replace(/ /g, " L")} L${last},${H} Z`
})

const gridLines = [0.25, 0.5, 0.75]

const xLabels = computed(() => {
    const n = props.data.length
    if (!n) return []
    const idx = n <= 2 ? [...Array(n).keys()] : [0, Math.floor((n - 1) / 2), n - 1]
    return idx.map((i) => ({left: ((i + 0.5) / n) * 100, label: shortDate(props.data[i]!.date)}))
})

function shortDate(date: string) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {month: "short", day: "numeric", timeZone: "UTC"})
}

const hovered = computed(() => (hover.value != null ? props.data[hover.value] : undefined))
const tooltipLeft = computed(() => (hover.value != null ? ((hover.value + 0.5) / props.data.length) * 100 : 0))

function onMove(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    hover.value = Math.min(props.data.length - 1, Math.max(0, Math.floor(ratio * props.data.length)))
}
</script>

<template>
    <div class="chart">
        <div class="legend tiny muted">
            <span><i class="sw msg" /> Messages</span>
            <span><i class="sw ses" /> Conversations</span>
            <span><i class="sw esc" /> Escalations</span>
        </div>
        <div class="plot" @pointermove="onMove" @pointerleave="hover = null">
            <span class="y-max tiny dim">{{ formatNumber(max) }}</span>
            <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" aria-label="Daily activity chart">
                <defs>
                    <linearGradient id="msg-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--violet)" stop-opacity="0.32" />
                        <stop offset="100%" stop-color="var(--violet)" stop-opacity="0" />
                    </linearGradient>
                </defs>
                <line v-for="g in gridLines" :key="g" x1="0" :x2="W" :y1="H * g" :y2="H * g" class="grid" vector-effect="non-scaling-stroke" />
                <line x1="0" :x2="W" :y1="H - 0.5" :y2="H - 0.5" class="axis" vector-effect="non-scaling-stroke" />
                <rect v-if="hover != null" :x="hover * slot" y="0" :width="slot" :height="H" class="hover-col" />
                <path :d="messagesArea" fill="url(#msg-fill)" />
                <polyline :points="messagesLine" class="msg-line" vector-effect="non-scaling-stroke" />
                <g v-for="(b, i) in bars" :key="i">
                    <rect :x="b.x" :y="b.sessionsY" :width="b.w" :height="b.sessionsH" class="bar-ses" :class="{dim: hover != null && hover !== i}" />
                    <rect v-if="b.escH" :x="b.x" :y="b.escY" :width="b.w" :height="b.escH" class="bar-esc" :class="{dim: hover != null && hover !== i}" />
                </g>
            </svg>
            <div v-if="hovered" class="tip panel" :style="{left: `${tooltipLeft}%`}" :class="{flip: tooltipLeft > 70, start: tooltipLeft < 30}">
                <p class="tiny dim">{{ shortDate(hovered.date) }}</p>
                <p class="tip-row">
                    <i class="sw msg" /> <span class="grow">Messages</span> <b>{{ hovered.messages }}</b>
                </p>
                <p class="tip-row">
                    <i class="sw ses" /> <span class="grow">Conversations</span> <b>{{ hovered.sessions }}</b>
                </p>
                <p class="tip-row">
                    <i class="sw esc" /> <span class="grow">Escalations</span> <b>{{ hovered.escalated }}</b>
                </p>
            </div>
        </div>
        <div class="x-labels tiny dim">
            <span v-for="l in xLabels" :key="l.left" :style="{left: `${l.left}%`}">{{ l.label }}</span>
        </div>
    </div>
</template>

<style scoped>
.chart {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.legend {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}
.legend span,
.tip-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.sw {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    display: inline-block;
}
.sw.msg {
    background: var(--violet);
}
.sw.ses {
    background: var(--accent);
}
.sw.esc {
    background: var(--warning);
}
.plot {
    position: relative;
    height: 220px;
    touch-action: pan-y;
}
.plot svg {
    width: 100%;
    height: 100%;
    overflow: visible;
}
.y-max {
    position: absolute;
    top: -8px;
    right: 0;
    background: var(--surface);
    padding-left: 6px;
}
.grid {
    stroke: var(--border);
    stroke-dasharray: 3 4;
}
.axis {
    stroke: var(--border-strong);
}
.hover-col {
    fill: rgb(255 255 255 / 0.03);
}
.msg-line {
    fill: none;
    stroke: var(--violet);
    stroke-width: 2;
    stroke-linejoin: round;
}
.bar-ses {
    fill: var(--accent);
    opacity: 0.9;
    transition: opacity 0.12s;
}
.bar-esc {
    fill: var(--warning);
    transition: opacity 0.12s;
}
.bar-ses.dim,
.bar-esc.dim {
    opacity: 0.35;
}
.tip {
    position: absolute;
    top: 8px;
    transform: translateX(-50%);
    pointer-events: none;
    padding: 8px 10px;
    min-width: 168px;
    background: var(--bg-elev);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
    z-index: 2;
}
.tip.flip {
    transform: translateX(calc(-100% - 12px));
}
.tip.start {
    transform: translateX(12px);
}
.tip-row {
    display: flex;
    width: 100%;
}
.tip-row b {
    font-variant-numeric: tabular-nums;
}
.x-labels {
    position: relative;
    height: 16px;
}
.x-labels span {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
}
.x-labels span:first-child {
    transform: none;
}
.x-labels span:last-child:not(:first-child) {
    transform: translateX(-100%);
}
</style>
