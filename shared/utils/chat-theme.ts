import type { ChatTheme } from '#shared/types'

export interface ChatThemePreset {
  name: string
  accent: string
  accent2: string
  highlight: string
  mode: ChatTheme['mode']
}

/** Colour presets of the chat widget (appearance editor, and theme detection for new projects). */
export const CHAT_THEME_PRESETS: ChatThemePreset[] = [
  { name: 'Aurora', accent: '#7c5cff', accent2: '#22d3ee', highlight: '#f5c451', mode: 'dark' },
  { name: 'Lime', accent: '#a3ff7a', accent2: '#3ddc97', highlight: '#9d8cff', mode: 'dark' },
  { name: 'Ocean', accent: '#2563eb', accent2: '#06b6d4', highlight: '#f59e0b', mode: 'light' },
  { name: 'Ember', accent: '#f97316', accent2: '#ef4444', highlight: '#facc15', mode: 'dark' },
  { name: 'Forest', accent: '#15803d', accent2: '#84cc16', highlight: '#0ea5e9', mode: 'light' },
  { name: 'Rose', accent: '#e11d74', accent2: '#a855f7', highlight: '#14b8a6', mode: 'light' },
  { name: 'Mono', accent: '#111827', accent2: '#6b7280', highlight: '#2563eb', mode: 'light' }
]
