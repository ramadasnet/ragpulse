import {expect, mock, test} from "bun:test"
import {parseCssColor} from "../server/utils/website-theme"
import {CHAT_THEME_PRESETS} from "../shared/utils/chat-theme"

mock.module("#shared/types", () => import("../shared/types/index.ts"))
const {chatThemeVars, resolveChatTheme} = await import("../app/utils/chat-theme")

function luminance(rgb: number[]) {
    const linear = rgb.map((component) => {
        const channel = component / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(ink: number[], background: number[]) {
    const a = luminance(ink)
    const b = luminance(background)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test.each(["Jade", "Dusk", "Marigold", "Terracotta", "Sandstone"])("%s source and support icons meet 3:1 contrast in both modes", (name) => {
    const preset = CHAT_THEME_PRESETS.find((theme) => theme.name === name)!
    for (const mode of ["light", "dark"] as const) {
        const vars = chatThemeVars(resolveChatTheme({...preset, mode}))
        const ink = parseCssColor(vars["--c-highlight-ink"]!)!
        const page = parseCssColor(vars["--c-bg"]!)!
        const bubble = parseCssColor(vars["--c-surface"]!)!
        const hoveredLink = parseCssColor(vars["--c-surface-2"]!)!
        const [rgb, alpha] = vars["--c-highlight-soft"]!.slice(4, -1).split(" / ")
        const tint = parseCssColor(`rgb(${rgb})`)!
        const opacity = Number(alpha)
        const tinted = (background: number[]) => background.map((channel, i) => channel + (tint[i]! - channel) * opacity)

        expect(contrast(ink, bubble)).toBeGreaterThanOrEqual(3)
        expect(contrast(ink, tinted(bubble))).toBeGreaterThanOrEqual(3)
        expect(contrast(ink, hoveredLink)).toBeGreaterThanOrEqual(3)
        expect(contrast(ink, tinted(page))).toBeGreaterThanOrEqual(3)
    }
})
