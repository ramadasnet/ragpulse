import type {ChatTheme} from "#shared/types"

export interface ChatThemePreset {
    name: string
    accent: string
    accent2: string
    highlight: string
    mode: ChatTheme["mode"]
}

/** Colour presets of the chat widget (appearance editor, and theme detection for new projects). */
export const CHAT_THEME_PRESETS: ChatThemePreset[] = [
    {name: "Aurora", accent: "#7c5cff", accent2: "#22d3ee", highlight: "#f5c451", mode: "dark"},
    {name: "Lime", accent: "#a3ff7a", accent2: "#3ddc97", highlight: "#9d8cff", mode: "dark"},
    {name: "Ocean", accent: "#2563eb", accent2: "#06b6d4", highlight: "#f59e0b", mode: "light"},
    {name: "Ember", accent: "#f97316", accent2: "#ef4444", highlight: "#facc15", mode: "dark"},
    {name: "Forest", accent: "#15803d", accent2: "#84cc16", highlight: "#0ea5e9", mode: "light"},
    {name: "Rose", accent: "#e11d74", accent2: "#a855f7", highlight: "#14b8a6", mode: "light"},
    {name: "Mono", accent: "#111827", accent2: "#6b7280", highlight: "#2563eb", mode: "light"},
    {name: "Jade", accent: "#4ade80", accent2: "#86efac", highlight: "#fde68a", mode: "dark"},
    {name: "Dusk", accent: "#a21caf", accent2: "#d946ef", highlight: "#99f6e4", mode: "dark"},
    {name: "Marigold", accent: "#facc15", accent2: "#fbbf24", highlight: "#fca5a5", mode: "dark"},
    {name: "Terracotta", accent: "#9a3412", accent2: "#92400e", highlight: "#166534", mode: "light"},
    {name: "Sandstone", accent: "#735c36", accent2: "#85734e", highlight: "#356a68", mode: "light"}
]
