// HTML / markdown-ish text → clean Markdown. Pure module (no Nuxt auto-imports) so it can be tested standalone.
import {parseHTML} from "linkedom"
import {Readability} from "@mozilla/readability"
import TurndownService from "turndown"
import type {IngestDetail} from "#shared/types"

export interface HtmlPage {
    title: string
    markdown: string
    /** Absolute http(s) links found on the page (before content extraction), for crawling */
    links: string[]
}

/** Elements that never carry useful content */
const NOISE = "script, style, noscript, template, iframe, svg, canvas, form, object, embed, video, audio, dialog, link, meta, .mw-editsection, sup.reference, .noprint"
/** Page chrome removed for the non-Readability fallback */
const LAYOUT = 'nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="search"], [aria-hidden="true"], .sr-only, .visually-hidden, .skip-link'
const ANCHOR_SYMBOLS = /^[\s#¶§🔗\u200b]*$/u

const escapeUrlChar = (c: string) => (c === "(" ? "%28" : c === ")" ? "%29" : "%20")

const turndowns = new Map<"standard" | "detailed", TurndownService>()

/** Turndown for a preset: `detailed` adds GFM styles (images, strikethrough, task lists, definition lists…). */
function getTurndown(detail: IngestDetail = "balanced"): TurndownService {
    const variant = detail === "detailed" ? "detailed" : "standard"
    const cached = turndowns.get(variant)
    if (cached) return cached
    const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        emDelimiter: "_",
        hr: "---"
    })
    td.remove(["script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "button", "select", "input", "textarea", "video", "audio", "object", "embed"] as any)

    td.addRule("image", {
        filter: "img",
        replacement: (_content, node: any) => {
            const alt = String(node.getAttribute("alt") || "")
                .replace(/\s+/g, " ")
                .trim()
            return alt.length >= 20 ? ` _[Image: ${alt}]_ ` : ""
        }
    })

    td.addRule("link", {
        filter: (node: any) => node.nodeName === "A" && !!node.getAttribute("href"),
        replacement: (content, node: any) => {
            const text = content.replace(/\s*\n+\s*/g, " ").trim()
            if (!text) return ""
            const href = String(node.getAttribute("href") || "")
            if (!/^(https?:|mailto:)/i.test(href)) return text
            const safeHref = href.replace(/[()\s]/g, escapeUrlChar)
            return `[${text}](${safeHref})`
        }
    })

    td.addRule("pre", {
        filter: (node: any) => node.nodeName === "PRE",
        replacement: (_content, node: any) => {
            const code = node.querySelector?.("code")
            const cls = `${code?.getAttribute("class") || ""} ${node.getAttribute("class") || ""} ${node.getAttribute("data-language") ? `language-${node.getAttribute("data-language")}` : ""}`
            const lang = /(?:language|lang)-([\w+#.-]+)/.exec(cls)?.[1] ?? ""
            const text = String(node.textContent || "").replace(/^\n+|\s+$/g, "")
            if (!text) return ""
            const fence = text.includes("```") ? "~~~~" : "```"
            return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`
        }
    })

    td.addRule("table", {
        filter: "table",
        replacement: (_content, node: any) => tableToMarkdown(node, td)
    })

    if (variant === "detailed") addDetailedRules(td)
    turndowns.set(variant, td)
    return td
}

function addDetailedRules(td: TurndownService) {
    td.addRule("imageDetailed", {
        filter: "img",
        replacement: (_content, node: any) => {
            const alt = String(node.getAttribute("alt") || node.getAttribute("title") || "")
                .replace(/\s+/g, " ")
                .replace(/[[\]]/g, "")
                .trim()
            const src = String(node.getAttribute("src") || "")
            if (alt.length < 3) return ""
            return /^https?:/i.test(src) ? `![${alt}](${src.replace(/[()\s]/g, escapeUrlChar)})` : ` _[Image: ${alt}]_ `
        }
    })
    td.addRule("strikethrough", {
        filter: ["del", "s", "strike"] as any,
        replacement: (content) => (content.trim() ? `~~${content.trim()}~~` : "")
    })
    td.addRule("highlight", {
        filter: ["mark"] as any,
        replacement: (content) => (content.trim() ? `**${content.trim()}**` : "")
    })
    td.addRule("kbd", {
        filter: ["kbd"] as any,
        replacement: (content) => (content.trim() ? `\`${content.trim()}\`` : "")
    })
    td.addRule("abbr", {
        filter: (node: any) => node.nodeName === "ABBR" && !!node.getAttribute("title"),
        replacement: (content, node: any) => `${content} (${String(node.getAttribute("title")).trim()})`
    })
    td.addRule("taskCheckbox", {
        filter: (node: any) => node.nodeName === "INPUT" && String(node.getAttribute("type")).toLowerCase() === "checkbox",
        replacement: (_content, node: any) => `${node.hasAttribute("checked") ? "[x]" : "[ ]"}${/^\s/.test(String(node.nextSibling?.textContent ?? "")) ? "" : " "}`
    })
    td.addRule("summary", {
        filter: ["summary"] as any,
        replacement: (content) => (content.trim() ? `\n\n**${content.trim()}**\n\n` : "")
    })
    td.addRule("figcaption", {
        filter: ["figcaption"] as any,
        replacement: (content) => (content.trim() ? `\n\n_${content.trim()}_\n\n` : "")
    })
    td.addRule("definitionTerm", {
        filter: ["dt"] as any,
        replacement: (content) => (content.trim() ? `\n\n**${content.trim()}**\n` : "")
    })
    td.addRule("definition", {
        filter: ["dd"] as any,
        replacement: (content) => (content.trim() ? `: ${content.trim().replace(/\n+/g, " ")}\n` : "")
    })
}

/** Detailed: embedded videos and frames become links (they are otherwise removed as noise). */
function embedsToLinks(document: any, base: string) {
    for (const el of Array.from(document.querySelectorAll("iframe[src], video[src], video source[src]")) as any[]) {
        const media = el.nodeName === "SOURCE" ? el.closest("video") : el
        if (!media?.parentNode) continue
        const label = normalizeSpace(media.getAttribute("title") || media.getAttribute("aria-label"))
        let href: string
        try {
            href = new URL(String(el.getAttribute("src")), base).href
        } catch {
            continue
        }
        if (!label || !/^https?:/i.test(href)) continue
        const p = document.createElement("p")
        const a = document.createElement("a")
        a.setAttribute("href", href)
        a.textContent = `${media.nodeName === "VIDEO" ? "Video" : "Embedded content"}: ${label}`
        p.appendChild(a)
        media.replaceWith(p)
    }
}

/** Detailed: image sources become absolute, so they can be kept as markdown images. */
function absolutizeImages(document: any, base: string) {
    for (const img of Array.from(document.querySelectorAll("img[src]")) as any[]) {
        try {
            img.setAttribute("src", new URL(String(img.getAttribute("src")), base).href)
        } catch {
            img.removeAttribute("src")
        }
    }
}

function tableToMarkdown(table: any, td: TurndownService): string {
    const rows: any[] = Array.from(table.querySelectorAll("tr"))
    const cellText = (cell: any) =>
        td
            .turndown(String(cell.innerHTML || ""))
            .replace(/\s*\n+\s*/g, " ")
            .replace(/\|/g, "\\|")
            .trim()
    const matrix: string[][] = rows
        .map((row) =>
            Array.from(row.children as ArrayLike<any>)
                .filter((c: any) => c.nodeName === "TD" || c.nodeName === "TH")
                .map(cellText)
        )
        .filter((cells) => cells.some((c) => c))
    if (!matrix.length) return ""
    const cols = Math.max(...matrix.map((r) => r.length))
    // Layout tables (single row / column) read better as paragraphs
    if (cols < 2 || matrix.length < 2) return `\n\n${matrix.flat().filter(Boolean).join("\n\n")}\n\n`
    const pad = (r: string[]) => Array.from({length: cols}, (_, i) => r[i] ?? "")
    const line = (r: string[]) => `| ${pad(r).join(" | ")} |`
    const [head, ...body] = matrix
    return `\n\n${[line(head!), `| ${Array.from({length: cols}, () => "---").join(" | ")} |`, ...body.map(line)].join("\n")}\n\n`
}

function normalizeSpace(s: string | null | undefined): string {
    return String(s || "")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

function stripHash(u: string): string {
    const i = u.indexOf("#")
    return i === -1 ? u : u.slice(0, i)
}

/** Makes links absolute, drops heading anchor links and collects crawlable links. */
function processLinks(document: any, base: string, pageUrl: string): string[] {
    const links = new Set<string>()
    const page = stripHash(pageUrl)
    for (const a of Array.from(document.querySelectorAll("a[href]")) as any[]) {
        const raw = String(a.getAttribute("href") || "").trim()
        const text = String(a.textContent || "")
        if (!raw || /^(javascript|data|tel|vbscript):/i.test(raw)) {
            a.removeAttribute("href")
            continue
        }
        let abs: string
        try {
            abs = new URL(raw, base).href
        } catch {
            a.removeAttribute("href")
            continue
        }
        const samePage = raw.startsWith("#") || stripHash(abs) === page
        if (samePage && ANCHOR_SYMBOLS.test(text) && !a.querySelector("img")) {
            a.remove()
            continue
        }
        if (raw.startsWith("#")) {
            a.removeAttribute("href")
            continue
        }
        a.setAttribute("href", abs)
        if (/^https?:/i.test(abs)) links.add(abs)
    }
    return [...links]
}

/** Removes page chrome and returns the semantic content container (single <article>, <main>), if any. */
function pickSemanticRoot(document: any): any {
    for (const el of Array.from(document.querySelectorAll(LAYOUT)) as any[]) el.remove()
    for (const el of Array.from(document.querySelectorAll("header, footer")) as any[]) {
        if (!el.closest?.('article, main, [role="main"]')) el.remove()
    }
    const articles = (Array.from(document.querySelectorAll("article")) as any[]).filter((a) => normalizeSpace(a.textContent).length >= 200)
    if (articles.length === 1) return articles[0]
    return document.querySelector("main") || document.querySelector('[role="main"]') || null
}

const countPre = (html: string) => (html.match(/<pre[\s>]/gi) || []).length

/** `<title>` when it contains the H1 (more specific, includes the site), else the H1, else meta titles. */
function extractTitle(document: any): string {
    const title = normalizeSpace(document.querySelector("title")?.textContent)
    const h1 = normalizeSpace(document.querySelector("h1")?.textContent)
        .replace(/[#¶§]+$/u, "")
        .trim()
    const og = normalizeSpace(document.querySelector('meta[property="og:title"]')?.getAttribute("content"))
    if (h1 && title && title.toLowerCase().includes(h1.toLowerCase())) return title
    if (h1 && h1.length <= 150) return h1
    return title || og
}

/** Converts a full HTML page to Markdown, keeping only the main content. */
export function htmlToMarkdown(html: string, pageUrl: string, opts: {detail?: IngestDetail} = {}): HtmlPage {
    const {document} = parseHTML(html) as any
    let base = pageUrl
    try {
        const href = document.querySelector("base[href]")?.getAttribute("href")
        if (href) base = new URL(href, pageUrl).href
    } catch {}

    const metaTitle = extractTitle(document)
    if (opts.detail === "detailed") {
        embedsToLinks(document, base)
        absolutizeImages(document, base)
    }
    const links = processLinks(document, base, pageUrl)
    for (const el of Array.from(document.querySelectorAll(NOISE)) as any[]) {
        if (el.nodeName !== "META" && el.nodeName !== "LINK") el.remove()
    }
    const cleaned = String(document.toString())

    let article: {title?: string | null; content?: string | null; textContent?: string | null} | null = null
    try {
        const readDoc = (parseHTML(cleaned) as any).document
        article = new Readability(readDoc, {charThreshold: 300, keepClasses: true}).parse()
    } catch {
        article = null
    }

    // Prefer the page's semantic container (docs sites mark it up well; Readability tends to drop code
    // blocks and tabbed content). Readability wins when there is none, or it is clearly cleaner without losing code.
    const semantic = pickSemanticRoot(document)
    const articleLen = normalizeSpace(article?.textContent).length
    const readable = article?.content && articleLen >= 200 ? article.content : null
    let contentHtml: string
    if (semantic) {
        const semanticHtml = String(semantic.innerHTML || "")
        const semanticLen = normalizeSpace(semantic.textContent).length
        contentHtml = readable && articleLen >= semanticLen * 0.6 && countPre(readable) >= countPre(semanticHtml) ? readable : semanticHtml
    } else {
        contentHtml = readable ?? String(document.body?.innerHTML || "")
    }

    const markdown = tidyMarkdown(getTurndown(opts.detail).turndown(contentHtml))
    const title = metaTitle || normalizeSpace(article?.title) || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || pageUrl
    return {title: title.slice(0, 300), markdown, links}
}

/** Converts an HTML fragment (pasted rich text) to Markdown, without page-level processing. */
export function htmlFragmentToMarkdown(html: string): string {
    return tidyMarkdown(getTurndown("detailed").turndown(html))
}

/** Normalizes whitespace: trailing spaces, CRLF, 3+ blank lines. */
export function tidyMarkdown(md: string): string {
    return md
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[\u200b\ufeff]/g, "")
        .replace(/[ \t]+$/gm, "")
        .replace(/^\s*\[\]\([^)]*\)\s*$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

/** Applies `fn` to every line that is outside fenced code blocks. Returning null drops the line. */
function mapOutsideFences(text: string, fn: (line: string) => string | null): string {
    const out: string[] = []
    let fence: string | null = null
    for (const line of text.split("\n")) {
        const m = /^\s*(`{3,}|~{3,})/.exec(line)
        if (m) {
            if (!fence) fence = m[1]!
            else if (m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length) fence = null
            out.push(line)
            continue
        }
        if (fence) {
            out.push(line)
            continue
        }
        const mapped = fn(line)
        if (mapped !== null) out.push(mapped)
    }
    return out.join("\n")
}

/**
 * Prepares a markdown / MDX file: strips frontmatter (using its `title`), MDX import/export and JSX-only lines,
 * HTML comments and presentational HTML.
 */
export function prepareMarkdownFile(text: string, opts: {mdx?: boolean; detail?: IngestDetail} = {}): {title?: string; markdown: string} {
    let md = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
    let title: string | undefined
    const fm = /^(---|\+\+\+)[ \t]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/.exec(md)
    if (fm) {
        const t = /^title\s*[:=]\s*(.+)$/m
            .exec(fm[2]!)?.[1]
            ?.trim()
            .replace(/^(['"])(.*)\1$/, "$2")
            .trim()
        if (t) title = t
        md = md.slice(fm[0].length)
    }
    md = md.replace(/<!--[\s\S]*?-->/g, "")

    let inMultilineExport = false
    md = mapOutsideFences(md, (line) => {
        if (opts.mdx) {
            if (inMultilineExport) {
                if (/^\s*$/.test(line)) inMultilineExport = false
                return null
            }
            if (/^\s*(import|export)\s/.test(line)) {
                // Multi-line `export const x = {` blocks run until the next blank line
                if (/[{([]\s*$/.test(line)) inMultilineExport = true
                return null
            }
            if (/^\s*<\/?[A-Z][\w.]*(\s[^<>]*)?\/?>\s*$/.test(line)) return null
            if (/^\s*\{\/\*.*\*\/\}\s*$/.test(line)) return null
        }
        if (opts.detail === "detailed") line = detailedHtmlInline(line)
        return line.replace(/<img\b[^>]*>/gi, "").replace(/<\/?(p|div|span|picture|source|br|center|sup|sub|details|summary|kbd|font|small|big)\b[^>]*>/gi, "")
    })

    md = tidyMarkdown(md)
    if (!title) title = /^#\s+(.+)$/m.exec(md)?.[1]?.replace(/[*_`]/g, "").trim()
    return {title, markdown: md}
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag)?.[2]?.trim() || ""

/** Detailed: inline HTML that carries content in markdown files (images with alt text, keys, summaries) becomes markdown. */
function detailedHtmlInline(line: string): string {
    return line
        .replace(/<img\b[^>]*>/gi, (tag) => {
            const alt = attr(tag, "alt").replace(/[[\]]/g, "")
            const src = attr(tag, "src")
            return alt.length >= 3 && src ? `![${alt}](${src.replace(/[()\s]/g, escapeUrlChar)})` : ""
        })
        .replace(/<kbd>([^<]+)<\/kbd>/gi, "`$1`")
        .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_m, t: string) => (t.trim() ? `**${t.trim()}**` : ""))
        .replace(/<(del|s|strike)>([^<]+)<\/\1>/gi, "~~$2~~")
}

/** reStructuredText: converts underlined (and over+underlined) headings to ATX headings. */
export function rstToMarkdown(text: string): string {
    const lines = text.replace(/\r\n?/g, "\n").split("\n")
    const levels: string[] = []
    const out: string[] = []
    const isUnderline = (l: string | undefined) => !!l && /^([=\-~^"'`#*+:._])\1{2,}\s*$/.test(l)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (isUnderline(line) && lines[i + 1]?.trim() && isUnderline(lines[i + 2])) {
            // Overlined heading: skip the overline, handled with the underline
            continue
        }
        const next = lines[i + 1]
        if (line.trim() && !isUnderline(line) && isUnderline(next) && next!.trim().length >= line.trim().length) {
            const ch = next!.trim()[0]!
            if (!levels.includes(ch)) levels.push(ch)
            out.push(`${"#".repeat(Math.min(6, levels.indexOf(ch) + 1))} ${line.trim()}`)
            i++
            continue
        }
        out.push(line)
    }
    return tidyMarkdown(out.join("\n"))
}

/** AsciiDoc: converts `== Title` headings to ATX headings. */
export function adocToMarkdown(text: string): string {
    return tidyMarkdown(mapOutsideFences(text.replace(/\r\n?/g, "\n"), (line) => line.replace(/^(={1,6})\s+(\S.*)$/, (_m, eq: string, t: string) => `${"#".repeat(eq.length)} ${t}`)))
}
