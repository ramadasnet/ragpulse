import type {ChatTheme} from "#shared/types"
import {DEFAULT_THEME} from "#shared/types"

// Chat widget theming helpers (used by the public chat page and the appearance editor).

function parseHex(hex: string): [number, number, number] | null {
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

function luminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
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
        "--c-shadow": "0 1px 2px rgb(20 22 30 / 0.06)"
    }
} as const

/** CSS variables for the chat root element. */
export function chatThemeVars(theme: ChatTheme): Record<string, string> {
    return {
        ...PALETTES[theme.mode === "light" ? "light" : "dark"],
        "--c-accent": theme.accent,
        "--c-accent-ink": chatInkOn(theme.accent),
        "--c-accent-soft": alpha(theme.accent, 0.14),
        "--c-accent2": theme.accent2,
        "--c-accent2-ink": chatInkOn(theme.accent2),
        "--c-highlight": theme.highlight,
        "--c-highlight-soft": alpha(theme.highlight, theme.mode === "light" ? 0.16 : 0.13),
        "--c-ring": `0 0 0 3px ${alpha(theme.highlight, 0.35)}`
    }
}

/** A message as rendered by the public chat UI. */
export interface ChatUiMessage {
    _id: string
    role: "user" | "assistant" | "agent"
    content: string
    sources?: Array<{title: string; url?: string}>
    escalated?: boolean
    createdAt?: string
    /** Assistant reply currently streaming */
    streaming?: boolean
    /** Error shown instead of an answer */
    error?: string
}
