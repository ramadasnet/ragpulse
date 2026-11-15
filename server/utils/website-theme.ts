import {parseHTML} from "linkedom"
import type {ChatTheme, Project} from "#shared/types"
import {assertPublicHost} from "./public-url"
import {CHAT_THEME_PRESETS, type ChatThemePreset} from "../../shared/utils/chat-theme"
import logger from "./logger"

// Picks the chat theme preset that best matches the colours of a website: the home page and its stylesheets are
// parsed, colours are weighted by where they are used (theme-color meta, brand custom properties, buttons, links,
// classes used on the page…) and the dominant brand colours are matched against the presets. The website's
// favicon is detected along the way and used as the project icon.

type Rgb = [number, number, number]
type Mode = ChatTheme["mode"]

export interface WebsiteStyle {
    /** Dominant brand colour (hex) */
    primary?: string
    /** Second brand colour, clearly different from the primary (hex) */
    secondary?: string
    /** Page background (hex) */
    background?: string
    mode?: Mode
}

export interface WebsiteThemeMatch {
    preset: ChatThemePreset
    mode: Mode
    style: WebsiteStyle
    /** Website icon (favicon) as a data URI, when one could be downloaded */
    icon?: string
}

// ---------- Colours ----------

const NAMED_COLORS: Record<string, Rgb> = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    navy: [0, 0, 128],
    teal: [0, 128, 128],
    purple: [128, 0, 128],
    maroon: [128, 0, 0],
    orange: [255, 165, 0],
    gold: [255, 215, 0],
    yellow: [255, 255, 0],
    rebeccapurple: [102, 51, 153],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    silver: [192, 192, 192]
}

const COLOR_TOKEN = new RegExp(`#[0-9a-f]{3,8}\\b|(?:rgba?|hsla?|oklch|oklab)\\([^()]*\\)|\\b(?:${Object.keys(NAMED_COLORS).join("|")})\\b`, "gi")

/** Parses a numeric CSS component; percentages are scaled to `percentScale`. NaN when invalid. */
function component(token: string | undefined, percentScale: number): number {
    if (!token) return Number.NaN
    if (token === "none") return 0
    const value = Number.parseFloat(token)
    return token.endsWith("%") ? (value / 100) * percentScale : value
}

function hslToRgb(h: number, s: number, l: number): Rgb {
    const hue = (((h % 360) + 360) % 360) / 360
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const channel = (t: number) => {
        const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
        if (x < 1 / 6) return p + (q - p) * 6 * x
        if (x < 1 / 2) return q
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
        return p
    }
    return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}

function oklabToRgb(L: number, a: number, b: number): Rgb {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const encode = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055)
    return [encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]
}

/** Parses an opaque CSS colour (hex, rgb, hsl, oklch, oklab, a few names). Null when invalid or mostly transparent. */
export function parseCssColor(input: string): Rgb | null {
    const value = input.trim().toLowerCase()
    if (value.startsWith("#")) {
        let hex = value.slice(1)
        if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null
        if (hex.length <= 4)
            hex = hex
                .split("")
                .map((c) => c + c)
                .join("")
        if (hex.length === 8 && Number.parseInt(hex.slice(6), 16) < 128) return null
        const n = Number.parseInt(hex.slice(0, 6), 16)
        return [n >> 16, (n >> 8) & 255, n & 255]
    }
    if (NAMED_COLORS[value]) return NAMED_COLORS[value]
    const fn = /^(rgba?|hsla?|oklch|oklab)\((.*)\)$/.exec(value)
    if (!fn) return null
    const [main = "", alphaPart] = fn[2]!.split("/")
    const parts = main.split(/[\s,]+/).filter(Boolean)
    if (parts.length < 3) return null
    const alpha = component((alphaPart ?? parts[3])?.trim(), 1)
    // Unresolved alpha (e.g. Tailwind's var(--tw-bg-opacity)) counts as opaque
    if (Number.isFinite(alpha) && alpha < 0.5) return null
    const [p0, p1, p2] = parts
    let rgb: Rgb
    switch (fn[1]) {
        case "rgb":
        case "rgba":
            rgb = [component(p0, 255), component(p1, 255), component(p2, 255)]
            break
        case "hsl":
        case "hsla":
            rgb = hslToRgb(component(p0, 360), component(p1, 100) / 100, component(p2, 100) / 100)
            break
        case "oklch": {
            const h = (component(p2, 360) * Math.PI) / 180
            const c = component(p1, 0.4)
            rgb = oklabToRgb(component(p0, 1), c * Math.cos(h), c * Math.sin(h))
            break
        }
        default:
            rgb = oklabToRgb(component(p0, 1), component(p1, 0.4), component(p2, 0.4))
    }
    if (rgb.some((c) => !Number.isFinite(c))) return null
    return rgb.map((c) => Math.max(0, Math.min(255, Math.round(c)))) as Rgb
}

function toHex(rgb: Rgb): string {
    return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`
}

function linear(c: number): number {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: Rgb): number {
    return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

function contrast(a: Rgb, b: Rgb): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
}

function toLab(rgb: Rgb): [number, number, number] {
    const [r, g, b] = rgb.map(linear) as Rgb
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** Perceptual distance (CIELAB) where lightness counts half: hue and saturation define a brand colour more than shade. */
function colorDistance(a: Rgb, b: Rgb): number {
    const [l1, a1, b1] = toLab(a)
    const [l2, a2, b2] = toLab(b)
    return Math.hypot((l1 - l2) * 0.5, a1 - a2, b1 - b2)
}

/** Colourful enough to be a brand colour (not a grey, near-white or near-black). */
function isChromatic(rgb: Rgb): boolean {
    const [l, a, b] = toLab(rgb)
    return l >= 15 && l <= 97 && Math.hypot(a, b) >= 18
}

function hexRgb(hex: string): Rgb {
    return parseCssColor(hex) ?? [0, 0, 0]
}

// ---------- CSS ----------

export interface CssRule {
    selector: string
    /** Enclosing @media conditions */
    media: string
    decls: Array<[string, string]>
}

const BLOCK_AT_RULES = new Set(["media", "supports", "layer", "container", "document", "scope", "starting-style"])

function matchingBrace(text: string, open: number): number {
    let depth = 0
    for (let i = open; i < text.length; i++) {
        if (text[i] === "{") depth++
        else if (text[i] === "}" && --depth === 0) return i
    }
    return text.length
}

function parseDeclarations(body: string): Array<[string, string]> {
    // Drop nested rules (CSS nesting): their prelude starts after the last `;` before the brace
    let flat = ""
    for (let i = 0; i < body.length; i++) {
        if (body[i] === "{") {
            flat = flat.slice(0, flat.lastIndexOf(";") + 1)
            i = matchingBrace(body, i)
            flat += ";"
        } else flat += body[i]
    }
    const decls: Array<[string, string]> = []
    for (const part of flat.split(";")) {
        const colon = part.indexOf(":")
        if (colon < 1) continue
        const prop = part.slice(0, colon).trim()
        if (!/^(--)?[\w-]+$/.test(prop)) continue
        decls.push([
            prop.startsWith("--") ? prop : prop.toLowerCase(),
            part
                .slice(colon + 1)
                .replace(/!important\s*$/i, "")
                .trim()
        ])
    }
    return decls
}

function parseBlock(text: string, media: string, parent: string, rules: CssRule[]): void {
    let i = 0
    while (i < text.length) {
        const open = text.indexOf("{", i)
        if (open < 0) break
        let prelude = text.slice(i, open)
        prelude = prelude.slice(Math.max(prelude.lastIndexOf(";"), prelude.lastIndexOf("}")) + 1).trim()
        const close = matchingBrace(text, open)
        const body = text.slice(open + 1, close)
        if (prelude.startsWith("@")) {
            const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? ""
            if (BLOCK_AT_RULES.has(name)) parseBlock(body, name === "media" ? `${media} ${prelude}`.trim() : media, parent, rules)
        } else if (prelude) {
            const selector = parent
                ? prelude
                      .split(",")
                      .map((s) => (s.includes("&") ? s.replaceAll("&", parent) : `${parent} ${s.trim()}`))
                      .join(",")
                : prelude
            rules.push({selector, media, decls: parseDeclarations(body)})
            if (body.includes("{")) parseBlock(body, media, selector, rules)
        }
        i = close + 1
    }
}

/** Minimal CSS parser: style rules with their declarations, flattened out of @media / @supports / @layer and nesting. */
export function parseCssRules(css: string): CssRule[] {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/gi, "url()")
    const rules: CssRule[] = []
    parseBlock(source, "", "", rules)
    return rules
}

const VAR_REF = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g

function resolveVars(value: string, lookup: (name: string) => string | undefined): string {
    for (let depth = 0; depth < 5 && value.includes("var("); depth++) {
        value = value.replace(VAR_REF, (_, name: string, fallback?: string) => lookup(name) ?? fallback ?? "")
    }
    return value
}

function colorsIn(value: string): Rgb[] {
    return [...value.matchAll(COLOR_TOKEN)].map((m) => parseCssColor(m[0])).filter((c): c is Rgb => !!c)
}

// ---------- Analysis ----------

const DARK_MEDIA = /prefers-color-scheme\s*:\s*dark/i
const DARK_SELECTOR = /\.dark\b|\.theme-dark\b|\[data-(?:bs-)?theme\s*=\s*["']?dark|\[data-(?:color-)?mode\s*=\s*["']?dark/i
const ROOT_SELECTOR = /^(?::root|html|body|:host|\*)$/i
const BRAND_SELECTOR = /btn|button|cta|primary|brand|accent|highlight|logo/i
const LINK_SELECTOR = /(?:^|[\s,>+~(])a(?=$|[\s,>+~:.[#)])|nav|header|hero|link|badge|menu/i
const BRAND_VAR = /primary|brand|accent|highlight|theme|main|cta/i
const SECONDARY_VAR = /secondary/i
const CLASS_NAME = /\.((?:\\.|[\w-])+)/g
const SKIP_STYLESHEET = /fonts\.(?:googleapis|bunny)|typekit|font-?awesome|material-?(?:icons|symbols)|icons?\.css/i

/** Weight of a colour by the property it is used in. */
function propertyWeight(prop: string): number {
    if (prop === "accent-color") return 4
    if (prop === "background" || prop === "background-color" || prop === "background-image") return 1.5
    if (prop === "color") return 1
    if (prop === "fill" || prop === "stroke" || prop === "text-decoration-color" || prop === "caret-color") return 0.8
    if (prop.startsWith("border") || prop.startsWith("outline")) return 0.6
    if (prop.endsWith("shadow")) return 0.2
    return 0
}

const unescapeCss = (s: string) => s.replace(/\\(.)/g, "$1")

function selectorParts(selector: string): string[] {
    return selector
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
}

/** Resolved href of a stylesheet `<link>`, or null when it is not a screen stylesheet. */
function stylesheetHref(link: any, baseUrl?: string): string | null {
    const rel = String(link.getAttribute("rel") || "")
        .toLowerCase()
        .split(/\s+/)
    const isSheet = rel.includes("stylesheet") || (rel.includes("preload") && String(link.getAttribute("as")).toLowerCase() === "style")
    if (!isSheet || rel.includes("alternate")) return null
    const media = String(link.getAttribute("media") || "").toLowerCase()
    if (media && !/all|screen/.test(media)) return null
    try {
        const url = new URL(String(link.getAttribute("href") || ""), baseUrl)
        if (url.protocol !== "http:" && url.protocol !== "https:") return null
        url.hash = ""
        return url.toString()
    } catch {
        return null
    }
}

/** Stylesheets worth downloading for the colour analysis, in document order (icon / font sheets are skipped). */
export function listStylesheetUrls(html: string, baseUrl: string): string[] {
    const {document} = parseHTML(html) as any
    const urls: string[] = []
    for (const link of document.querySelectorAll("link[href]")) {
        const href = stylesheetHref(link, baseUrl)
        if (href && !SKIP_STYLESHEET.test(href) && !urls.includes(href)) urls.push(href)
    }
    return urls
}

/** Finds the brand colours, page background and light/dark mode of an HTML page and its stylesheets. */
export function analyzeWebsiteStyles(html: string, opts: {baseUrl?: string; stylesheets?: Record<string, string>} = {}): WebsiteStyle {
    const {document} = parseHTML(html) as any
    const htmlEl = document.documentElement
    const body = document.body
    const roots = [htmlEl, body].filter(Boolean)

    const classUsage = new Map<string, number>()
    for (const el of document.querySelectorAll("[class]")) {
        for (const name of String(el.getAttribute("class")).split(/\s+/)) {
            if (name) classUsage.set(name, (classUsage.get(name) ?? 0) + 1)
        }
    }
    // Classes on <html> / <body> (e.g. Tailwind `bg-slate-950`) style the page background
    const rootClasses = new Map<string, number>()
    roots.forEach((el: any, i: number) => {
        for (const name of String(el.getAttribute("class") || "").split(/\s+/)) if (name) rootClasses.set(name, i + 1)
    })
    const rootAttrs = roots.map((el: any) => ["class", "data-theme", "data-bs-theme", "data-mode", "data-color-mode", "style"].map((a) => el.getAttribute(a) || "").join(" ")).join(" ")
    const pageDark = /\bdark\b/i.test(rootAttrs)

    const rules: CssRule[] = []
    for (const el of document.querySelectorAll("style, link[href]")) {
        if (String(el.tagName).toLowerCase() === "style") rules.push(...parseCssRules(el.textContent || ""))
        else {
            const href = stylesheetHref(el, opts.baseUrl)
            const css = href ? opts.stylesheets?.[href] : undefined
            if (css) rules.push(...parseCssRules(css))
        }
    }

    const isAlternate = (rule: CssRule) => !pageDark && (DARK_MEDIA.test(rule.media) || DARK_SELECTOR.test(rule.selector))
    const isPrintOnly = (rule: CssRule) => /\bprint\b/i.test(rule.media) && !/\b(?:screen|all)\b/i.test(rule.media)

    // Custom properties: the ones set on the root (or the active dark theme) win over the others
    const isRootRule = (rule: CssRule) => selectorParts(rule.selector).some((p) => ROOT_SELECTOR.test(p)) || (pageDark && DARK_SELECTOR.test(rule.selector))
    const rootVars = new Map<string, string>()
    const otherVars = new Map<string, string>()
    for (const rule of rules) {
        if (isPrintOnly(rule) || isAlternate(rule)) continue
        const rootLike = isRootRule(rule)
        for (const [prop, value] of rule.decls) {
            if (!prop.startsWith("--")) continue
            if (rootLike) rootVars.set(prop, value)
            else if (!otherVars.has(prop)) otherVars.set(prop, value)
        }
    }

    const tally = new Map<string, {rgb: Rgb; weight: number}>()
    const add = (rgb: Rgb, weight: number) => {
        if (weight <= 0) return
        const key = toHex(rgb)
        const entry = tally.get(key)
        if (entry) entry.weight += weight
        else tally.set(key, {rgb, weight})
    }

    let background: {rgb: Rgb; priority: number} | undefined
    const setBackground = (rgb: Rgb | undefined, priority: number) => {
        if (rgb && (!background || priority >= background.priority)) background = {rgb, priority}
    }
    const pagePriority = (parts: string[]): number => {
        let best = 0
        for (const part of parts) {
            if (/^(?:html|:root)$/i.test(part)) best = Math.max(best, 1)
            else if (/^(?:body|html\s*>?\s*body|#__next|#__nuxt|#app|#root)$/i.test(part)) best = Math.max(best, 2)
            else {
                const m = /^\.((?:\\.|[\w-])+)$/.exec(part)
                const p = m ? rootClasses.get(unescapeCss(m[1]!)) : undefined
                if (p) best = Math.max(best, p)
            }
        }
        return best
    }
    const selectorWeight = (selector: string): number => {
        let weight = BRAND_SELECTOR.test(selector) ? 4 : LINK_SELECTOR.test(selector) ? 2 : 1
        const classes = [...selector.matchAll(CLASS_NAME)].map((m) => unescapeCss(m[1]!))
        if (!classes.length) return weight * 1.5
        const used = Math.max(0, ...classes.map((c) => classUsage.get(c) ?? 0))
        // Rules for classes that are not on the page (unused framework components) barely count
        return weight * (used ? 1 + Math.log2(1 + Math.min(used, 64)) : 0.15)
    }

    const brandVarWeight = (prop: string) => (BRAND_VAR.test(prop) ? 6 : SECONDARY_VAR.test(prop) ? 3 : 0)
    for (const rule of rules) {
        if (isPrintOnly(rule)) continue
        const alternate = isAlternate(rule)
        const rootRule = !alternate && isRootRule(rule)
        const local = new Map(rule.decls.filter(([p]) => p.startsWith("--")))
        const lookup = (name: string) => local.get(name) ?? rootVars.get(name) ?? otherVars.get(name)
        const priority = alternate ? 0 : pagePriority(selectorParts(rule.selector))
        const factor = (alternate ? 0.3 : 1) * selectorWeight(rule.selector)
        for (const [prop, raw] of rule.decls) {
            if (prop.startsWith("--")) {
                // Root variables are counted once below with their effective value
                if (rootRule || prop.startsWith("--tw-")) continue
                const rgb = parseCssColor(resolveVars(raw, lookup))
                if (rgb) add(rgb, brandVarWeight(prop) * (alternate ? 0.3 : 1) || 0.5 * factor)
                continue
            }
            const colors = colorsIn(resolveVars(raw, lookup))
            if (!colors.length) continue
            colors.forEach((rgb) => add(rgb, propertyWeight(prop) * factor))
            if (priority && (prop === "background" || prop === "background-color")) setBackground(colors[0], priority)
        }
    }
    // Brand variables on the root count even when unused; other root palettes (e.g. Tailwind's) only through usage
    for (const [prop, raw] of rootVars) {
        const rgb = brandVarWeight(prop) ? parseCssColor(resolveVars(raw, (name) => rootVars.get(name) ?? otherVars.get(name))) : null
        if (rgb) add(rgb, brandVarWeight(prop))
    }

    // Inline styles and SVG paint attributes are actual usage on the page
    for (const el of document.querySelectorAll("[style], [fill], [stroke], [bgcolor]")) {
        const tag = String(el.tagName).toLowerCase()
        const pagePrio = tag === "body" ? 4 : tag === "html" ? 3 : 0
        for (const [prop, raw] of parseDeclarations(String(el.getAttribute("style") || ""))) {
            const colors = colorsIn(resolveVars(raw, (name) => rootVars.get(name) ?? otherVars.get(name)))
            colors.forEach((rgb) => add(rgb, propertyWeight(prop) * 3))
            if (pagePrio && (prop === "background" || prop === "background-color")) setBackground(colors[0], pagePrio)
        }
        for (const attr of ["fill", "stroke"]) {
            const rgb = parseCssColor(String(el.getAttribute(attr) || ""))
            if (rgb) add(rgb, 1)
        }
        if (tag === "body") setBackground(parseCssColor(String(el.getAttribute("bgcolor") || "")) ?? undefined, 4)
    }

    let themeColor: Rgb | undefined
    let colorScheme = ""
    for (const meta of document.querySelectorAll("meta[name][content]")) {
        const name = String(meta.getAttribute("name")).toLowerCase()
        const content = String(meta.getAttribute("content"))
        if (name === "color-scheme") colorScheme = content
        if (name !== "theme-color" && name !== "msapplication-tilecolor" && name !== "msapplication-navbutton-color") continue
        if (!pageDark && DARK_MEDIA.test(String(meta.getAttribute("media") || ""))) continue
        const rgb = parseCssColor(content)
        if (!rgb) continue
        add(rgb, name === "theme-color" ? 25 : 8)
        if (name === "theme-color") themeColor ??= rgb
    }

    // Brand colours: chromatic colours grouped by similarity, heaviest group first
    const clusters: Array<{rgb: Rgb; weight: number}> = []
    for (const entry of [...tally.values()].filter((e) => isChromatic(e.rgb)).sort((a, b) => b.weight - a.weight)) {
        const near = clusters.find((c) => colorDistance(c.rgb, entry.rgb) < 14)
        if (near) near.weight += entry.weight
        else clusters.push({...entry})
    }
    clusters.sort((a, b) => b.weight - a.weight)
    const primary = clusters[0] && clusters[0].weight >= 3 ? clusters[0] : undefined
    const secondary = primary && clusters.find((c) => c !== primary && colorDistance(c.rgb, primary.rgb) > 25 && c.weight >= primary.weight * 0.1)

    let mode: Mode | undefined
    if (background) mode = luminance(background.rgb) < 0.2 ? "dark" : "light"
    else if (pageDark || /^\s*dark\s*$/i.test(colorScheme)) mode = "dark"
    else if (themeColor && !isChromatic(themeColor)) mode = luminance(themeColor) < 0.2 ? "dark" : "light"

    const style: WebsiteStyle = {}
    if (primary) style.primary = toHex(primary.rgb)
    if (secondary) style.secondary = toHex(secondary.rgb)
    if (background) style.background = toHex(background.rgb)
    if (mode) style.mode = mode
    return style
}

// ---------- Preset matching ----------

/** Chat page backgrounds per mode (see the palettes in app/utils/chat-theme.ts) */
const CHAT_BACKGROUND: Record<Mode, Rgb> = {dark: [12, 14, 19], light: [246, 246, 243]}

/** The preset closest to the website's brand colours, and the chat mode (the website's when the accent stays visible). */
export function pickThemePreset(style: WebsiteStyle): {preset: ChatThemePreset; mode: Mode} {
    const primary = style.primary ? parseCssColor(style.primary) : null
    const secondary = style.secondary ? parseCssColor(style.secondary) : null
    const mono = CHAT_THEME_PRESETS.find((p) => p.name === "Mono") ?? CHAT_THEME_PRESETS[0]!
    let preset = mono
    if (primary) {
        let best = Number.POSITIVE_INFINITY
        // A website with brand colours gets a colourful preset; the monochrome one is for websites without
        for (const p of CHAT_THEME_PRESETS.filter((p) => p !== mono)) {
            let score = colorDistance(primary, hexRgb(p.accent))
            if (secondary) score += 0.35 * Math.min(colorDistance(secondary, hexRgb(p.accent2)), colorDistance(secondary, hexRgb(p.highlight)))
            if (style.mode && style.mode !== p.mode) score += 6
            if (score < best) {
                best = score
                preset = p
            }
        }
    }
    // Without a detected background the page uses the browser's default white
    const wanted = style.mode ?? "light"
    const mode = contrast(hexRgb(preset.accent), CHAT_BACKGROUND[wanted]) >= 1.8 ? wanted : preset.mode
    return {preset, mode}
}

// ---------- Fetching ----------

const PAGE_TIMEOUT_MS = 10_000
const STYLESHEET_TIMEOUT_MS = 6000
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_STYLESHEET_BYTES = 1536 * 1024
const MAX_STYLESHEETS = 6

/** GET returning at most `maxBytes` of the body; `truncated` is set when the stream had more to give. */
export async function fetchPrefix(
    url: string,
    opts: {userAgent: string; accept: string; timeoutMs: number; maxBytes: number; signal?: AbortSignal}
): Promise<{url: string; type: string; charset: string; bytes: Uint8Array; truncated: boolean} | null> {
    try {
        await assertPublicHost(url, "URL")
        const timeout = AbortSignal.timeout(opts.timeoutMs)
        const res = await fetch(url, {
            redirect: "follow",
            signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
            headers: {"User-Agent": opts.userAgent, Accept: opts.accept}
        })
        // Redirects are followed inside fetch: the final URL needs its own check
        const finalUrl = res.url || url
        if (finalUrl !== url) {
            try {
                await assertPublicHost(finalUrl, "Redirect target")
            } catch {
                await res.body?.cancel().catch(() => {})
                return null
            }
        }
        if (!res.ok || !res.body) {
            await res.body?.cancel().catch(() => {})
            return null
        }
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let total = 0
        while (total < opts.maxBytes) {
            const {done, value} = await reader.read()
            if (done) break
            chunks.push(value)
            total += value.byteLength
        }
        let truncated = total > opts.maxBytes
        if (total === opts.maxBytes) {
            // One more read tells whether the stream ended exactly at the cap
            const {done, value} = await reader.read()
            if (!done) {
                truncated = true
                if (value) {
                    chunks.push(value)
                    total += value.byteLength
                }
            }
        }
        await reader.cancel().catch(() => {})
        const bytes = new Uint8Array(Math.min(total, opts.maxBytes))
        let offset = 0
        for (const chunk of chunks) {
            const part = chunk.subarray(0, bytes.length - offset)
            bytes.set(part, offset)
            offset += part.byteLength
        }
        const contentType = res.headers.get("content-type") || ""
        const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] || ""
        return {url: res.url || url, type: contentType.split(";")[0]!.trim().toLowerCase(), charset, bytes, truncated}
    } catch {
        return null
    }
}

/** Text variant of fetchPrefix (a truncated page or stylesheet is still useful). */
async function fetchTextPrefix(url: string, opts: {userAgent: string; accept: string; timeoutMs: number; maxBytes: number; signal?: AbortSignal}): Promise<{url: string; type: string; text: string} | null> {
    const res = await fetchPrefix(url, opts)
    if (!res) return null
    let decoder: TextDecoder
    try {
        decoder = new TextDecoder(res.charset || "utf-8")
    } catch {
        decoder = new TextDecoder()
    }
    return {url: res.url, type: res.type, text: decoder.decode(res.bytes)}
}

/** Downloads the website's home page, stylesheets and icon, and picks the closest chat theme. Null when the page can't be read. */
export async function detectWebsiteTheme(url: string, opts: {userAgent: string; signal?: AbortSignal}): Promise<WebsiteThemeMatch | null> {
    const page = await fetchTextPrefix(url, {...opts, accept: "text/html,application/xhtml+xml", timeoutMs: PAGE_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES})
    if (!page || (page.type && !page.type.includes("html"))) return null
    const urls = listStylesheetUrls(page.text, page.url).slice(0, MAX_STYLESHEETS)
    const [sheets, icon] = await Promise.all([Promise.all(urls.map((u) => fetchTextPrefix(u, {...opts, accept: "text/css,*/*;q=0.1", timeoutMs: STYLESHEET_TIMEOUT_MS, maxBytes: MAX_STYLESHEET_BYTES}))), detectFavicon(page.text, page.url, opts)])
    const stylesheets: Record<string, string> = {}
    urls.forEach((u, i) => {
        const sheet = sheets[i]
        if (sheet && !sheet.type.includes("html")) stylesheets[u] = sheet.text
    })
    const style = analyzeWebsiteStyles(page.text, {baseUrl: page.url, stylesheets})
    return {...pickThemePreset(style), style, icon: icon ?? undefined}
}

/**
 * Sets the chat colours and icon of a newly created project from its website. Runs in the background after
 * creation and leaves the project alone if it was edited in the meantime.
 */
export async function applyWebsiteBranding(project: Project): Promise<void> {
    const settings = await getAppSettings()
    const match = await detectWebsiteTheme(project.website, {userAgent: settings.userAgent || defaultUserAgent()})
    if (!match) {
        logger.info("WebsiteTheme.apply", project.website, "Could not read the website, keeping the default chat theme")
        return
    }
    const {preset, mode, style, icon} = match
    const theme: ChatTheme = {...project.theme, accent: preset.accent, accent2: preset.accent2, highlight: preset.highlight, mode}
    const {projects} = await useCollections()
    const result = await projects.updateOne({_id: project._id, updatedAt: project.updatedAt}, {$set: {theme, ...(icon ? {icon} : {})}})
    if (result.modifiedCount) {
        logger.info("WebsiteTheme.apply", project.website, `Chat theme "${preset.name}" (${mode}), brand colours ${[style.primary, style.secondary].filter(Boolean).join(", ") || "none"}${icon ? ", icon found" : ""}`)
    }
}

// ---------- Favicon ----------

const ICON_TIMEOUT_MS = 5000
const MAX_ICON_BYTES = 256 * 1024
const MAX_ICON_CANDIDATES = 4

/** Ordered icon candidates of an HTML page, best first; `/favicon.ico` is the implicit last resort. */
export function faviconUrls(html: string, baseUrl: string): string[] {
    const {document} = parseHTML(html) as any
    const candidates: {url: string; score: number}[] = []
    for (const link of document.querySelectorAll("link[href]")) {
        const rel = String(link.getAttribute("rel") || "").toLowerCase()
        if (!rel.includes("icon")) continue
        const href = String(link.getAttribute("href") || "").trim()
        if (!href || href.startsWith("javascript:")) continue
        let url: string
        if (href.startsWith("data:")) url = href
        else {
            try {
                const parsed = new URL(href, baseUrl)
                if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
                parsed.hash = ""
                url = parsed.toString()
            } catch {
                continue
            }
        }
        const type = String(link.getAttribute("type") || "").toLowerCase()
        const sizes = String(link.getAttribute("sizes") || "").toLowerCase()
        const svg = type.includes("svg") || /\.svg($|[?#])/i.test(url)
        let dimension = 0
        for (const size of sizes.split(/\s+/)) {
            const side = /^(\d+)x\d+$/.exec(size)?.[1]
            if (side) dimension = Math.max(dimension, Number(side))
        }
        if (sizes === "any") dimension = 999
        let score = Math.min(dimension, 512)
        if (svg)
            score += 2000 // scalable icons stay crisp at any size
        else if (rel.includes("apple-touch-icon")) score += 500 // apple touch icons are large and square
        if (dimension && dimension < 32) score -= 200 // a 16px icon is too small for the sidebar
        if (rel.includes("mask-icon")) score -= 5000 // monochrome masks need a tint colour
        candidates.push({url, score})
    }
    candidates.sort((a, b) => b.score - a.score)
    const urls = [...new Set(candidates.map((c) => c.url))]
    try {
        const fallback = new URL("/favicon.ico", baseUrl).toString()
        if (!urls.includes(fallback)) urls.push(fallback)
    } catch {}
    return urls
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

/** Mime type from magic bytes (PNG/JPEG/GIF/ICO/WebP/AVIF) or an `<svg` tag. Null when it doesn't look like an image. */
export function sniffImageMime(bytes: Uint8Array): string | null {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
    if (bytes.length >= 4 && asciiAt(bytes, 0, 4) === "GIF8") return "image/gif"
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon"
    if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "image/webp"
    if (bytes.length >= 12 && asciiAt(bytes, 4, 4) === "ftyp" && (asciiAt(bytes, 8, 4) === "avif" || asciiAt(bytes, 8, 4) === "avis")) return "image/avif"
    if (new TextDecoder().decode(bytes.subarray(0, 1024)).includes("<svg")) return "image/svg+xml"
    return null
}

const ICON_EXT_MIME: [RegExp, string][] = [
    [/\.svg($|[?#])/i, "image/svg+xml"],
    [/\.png($|[?#])/i, "image/png"],
    [/\.ico($|[?#])/i, "image/x-icon"],
    [/\.jpe?g($|[?#])/i, "image/jpeg"],
    [/\.webp($|[?#])/i, "image/webp"],
    [/\.gif($|[?#])/i, "image/gif"],
    [/\.avif($|[?#])/i, "image/avif"]
]

/** Best mime for a downloaded icon: sniffed bytes first, then the declared type, then the file extension. */
function iconMime(url: string, type: string, bytes: Uint8Array): string | null {
    return sniffImageMime(bytes) ?? (type.startsWith("image/") ? type : null) ?? ICON_EXT_MIME.find(([re]) => re.test(url))?.[1] ?? null
}

const DATA_IMAGE_RE = /^data:(image\/[\w.+-]+);base64,[a-z0-9+/=]+$/i

/** Downloads an icon URL and returns it as a data URI; `data:` hrefs pass through. Null on failure. */
export async function fetchIconDataUri(url: string, opts: {userAgent: string; signal?: AbortSignal}): Promise<string | null> {
    if (url.startsWith("data:")) return DATA_IMAGE_RE.test(url) && url.length <= MAX_ICON_BYTES * 1.5 ? url : null
    const res = await fetchPrefix(url, {...opts, accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.1", timeoutMs: ICON_TIMEOUT_MS, maxBytes: MAX_ICON_BYTES})
    if (!res || res.truncated) return null
    const mime = iconMime(url, res.type, res.bytes)
    if (!mime) return null
    return `data:${mime};base64,${Buffer.from(res.bytes).toString("base64")}`
}

/** Downloads the best available icon of an already fetched HTML page as a data URI. */
export async function detectFavicon(html: string, baseUrl: string, opts: {userAgent: string; signal?: AbortSignal}): Promise<string | null> {
    for (const url of faviconUrls(html, baseUrl).slice(0, MAX_ICON_CANDIDATES)) {
        const icon = await fetchIconDataUri(url, opts)
        if (icon) return icon
    }
    return null
}

/** Fetches a website's home page and returns its icon as a data URI. */
export async function detectProjectFavicon(websiteUrl: string, opts: {userAgent: string; signal?: AbortSignal}): Promise<string | null> {
    const page = await fetchTextPrefix(websiteUrl, {...opts, accept: "text/html,application/xhtml+xml", timeoutMs: PAGE_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES})
    if (!page || (page.type && !page.type.includes("html"))) return null
    return detectFavicon(page.text, page.url, opts)
}
