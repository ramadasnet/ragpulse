import type {ChatTheme} from "#shared/types"
import {DEFAULT_THEME} from "#shared/types"

// Chat widget theming and message helpers (used by the public chat page and the appearance editor).

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb | null {
    let h = String(hex || "")
        .trim()
        .replace(/^#/, "")
    if (/^[0-9a-f]{3}$/i.test(h))
        h = h
            .split("")
            .map((c) => c + c)
            .join("")
    if (!/^[0-9a-f]{6}$/i.test(h)) return null
    const n = Number.parseInt(h, 16)
    return [n >> 16, (n >> 8) & 255, n & 255]
}

export function isHexColor(value: string): boolean {
    return !!parseHex(value)
}

function luminance(rgb: Rgb): number {
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Readable text colour (near black or white) on top of the given background colour. */
export function chatInkOn(hex: string): string {
    const rgb = parseHex(hex)
    if (!rgb) return "#ffffff"
    return luminance(rgb) > 0.45 ? "#0b0d12" : "#ffffff"
}

function alpha(hex: string, a: number): string {
    const rgb = parseHex(hex)
    return rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${a})` : "transparent"
}

export function resolveChatTheme(theme?: Partial<ChatTheme> | null): ChatTheme {
    const t = {...DEFAULT_THEME, ...(theme || {})}
    return {
        ...t,
        mode: t.mode === "light" ? "light" : "dark",
        accent: isHexColor(t.accent) ? t.accent : DEFAULT_THEME.accent,
        accent2: isHexColor(t.accent2) ? t.accent2 : DEFAULT_THEME.accent2,
        highlight: isHexColor(t.highlight) ? t.highlight : DEFAULT_THEME.highlight,
        position: t.position === "left" ? "left" : "right"
    }
}

const PALETTES = {
    dark: {
        "--c-bg": "#0c0e13",
        "--c-surface": "#141821",
        "--c-surface-2": "#1b202b",
        "--c-border": "rgb(255 255 255 / 0.08)",
        "--c-text": "#eceff5",
        "--c-muted": "#9ba3b4",
        "--c-dim": "#6c7486",
        "--c-error": "#fca5a5",
        "--c-error-soft": "rgb(248 113 113 / 0.1)",
        "--c-error-border": "rgb(248 113 113 / 0.3)",
        "--c-shadow": "0 1px 2px rgb(0 0 0 / 0.4)"
    },
    light: {
        "--c-bg": "#f6f6f3",
        "--c-surface": "#ffffff",
        "--c-surface-2": "#efefea",
        "--c-border": "rgb(20 22 30 / 0.09)",
        "--c-text": "#15171c",
        "--c-muted": "#5d6372",
        "--c-dim": "#8a909c",
        "--c-error": "#991b1b",
        "--c-error-soft": "rgb(248 113 113 / 0.08)",
        "--c-error-border": "#dc2626",
        "--c-shadow": "0 1px 2px rgb(20 22 30 / 0.06)"
    }
} as const

function mixRgb(base: Rgb, overlay: Rgb, opacity: number): Rgb {
    return base.map((value, i) => Math.round(value * (1 - opacity) + overlay[i]! * opacity)) as Rgb
}

/** Tints icon ink toward the text colour until it contrasts with plain and highlighted surfaces. */
function highlightInk(hex: string, palette: (typeof PALETTES)[ChatTheme["mode"]], opacity: number): string {
    const highlight = parseHex(hex)
    if (!highlight) return palette["--c-text"]
    const text = parseHex(palette["--c-text"])!
    const background = parseHex(palette["--c-bg"])!
    const surface = parseHex(palette["--c-surface"])!
    const hovered = parseHex(palette["--c-surface-2"])!
    const backgrounds = [background, surface, hovered, mixRgb(background, highlight, opacity), mixRgb(surface, highlight, opacity)].map(luminance)
    for (let step = 0; step < 20; step++) {
        const ink = mixRgb(highlight, text, step / 20)
        const light = luminance(ink)
        if (backgrounds.every((bg) => (Math.max(light, bg) + 0.05) / (Math.min(light, bg) + 0.05) >= 3)) return step ? `rgb(${ink.join(" ")})` : hex
    }
    return palette["--c-text"]
}

/** CSS variables for the chat root element. */
export function chatThemeVars(theme: ChatTheme): Record<string, string> {
    const palette = PALETTES[theme.mode === "light" ? "light" : "dark"]
    const highlightOpacity = theme.mode === "light" ? 0.16 : 0.13
    return {
        ...palette,
        "--c-accent": theme.accent,
        "--c-accent-ink": chatInkOn(theme.accent),
        "--c-accent-soft": alpha(theme.accent, 0.14),
        "--c-accent2": theme.accent2,
        "--c-accent2-ink": chatInkOn(theme.accent2),
        "--c-highlight": theme.highlight,
        "--c-highlight-ink": highlightInk(theme.highlight, palette, highlightOpacity),
        "--c-highlight-soft": alpha(theme.highlight, highlightOpacity),
        "--c-ring": `0 0 0 3px ${alpha(theme.highlight, 0.35)}`
    }
}

/** A message as rendered by the public chat UI. */
export interface ChatUiMessage {
    _id: string
    role: "user" | "assistant" | "agent"
    content: string
    supportName?: string
    sources?: Array<{title: string; url?: string; kind: "docs" | "code"}>
    escalated?: boolean
    /** Nobody took over the escalated chat in time: the "answer comes by email" notice */
    emailFallback?: boolean
    createdAt?: string
    /** Assistant reply currently streaming */
    streaming?: boolean
    /** Error shown instead of an answer */
    error?: string
}

/**
 * Message the visitor details form shows under: the latest escalation, or the later "answer comes by email" notice,
 * while the visitor's name or email is still missing. The form shows on escalation, before any email notice.
 */
export function detailsFormMessageId(messages: ChatUiMessage[], details: {visitorName?: string; visitorEmail?: string}): string | undefined {
    if (details.visitorName && details.visitorEmail) return undefined
    return [...messages].reverse().find((m) => m.escalated || m.emailFallback)?._id
}
