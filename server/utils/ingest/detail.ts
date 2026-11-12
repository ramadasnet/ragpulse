// Ingestion presets (compact / balanced / detailed): chunk sizes and markdown refinement. Pure module (no Nuxt auto-imports).
import type {IngestDetail} from "#shared/types"
import {splitBlocks, type ChunkOptions} from "./chunker"

/**
 * Chunk sizes per preset. Every chunk stores an embedding (~20 KB in MongoDB at 1536 dimensions, far more than its
 * text), so fewer, larger chunks shrink the index the most. Smaller chunks with more overlap retrieve more precisely.
 */
export const CHUNK_PRESETS: Record<IngestDetail, Required<ChunkOptions>> = {
    compact: {target: 2400, max: 3600, overlap: 0, minChars: 80},
    balanced: {target: 1800, max: 3000, overlap: 200, minChars: 40},
    detailed: {target: 1400, max: 2400, overlap: 300, minChars: 30}
}

/** Compact: code blocks longer than this are truncated */
export const COMPACT_MAX_CODE_LINES = 100
/** Blocks shorter than this (normalized) are never deduplicated */
const MIN_DEDUP_KEY = 12
/** Across documents, only substantial blocks (boilerplate, footers, CTAs) are deduplicated */
const MIN_CROSS_DEDUP_KEY = 60

/**
 * Balanced removes exact repeats only (whitespace aside), and only substantial ones: a copy of everything removed stays
 * in the index, so no answer can lose information.
 */
const EXACT_MIN_BLOCK_CHARS = 80
const EXACT_MIN_CROSS_BLOCK_CHARS = 200
const EXACT_MIN_PAGE_LINE_CHARS = 40
const EXACT_MIN_PAGE_RATIO = 0.75

/** Repeated content is compared ignoring formatting and punctuation (compact), or as exact text (balanced) */
export type DedupeMode = "similar" | "exact"

const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^(#{1,6})\s+(.*)$/
const LIST_ITEM = /^(\s*)([-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/

/** Lowercase letters and digits only: blocks that differ in formatting, spacing or punctuation compare equal. */
export function similarityKey(text: string): string {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

/** Exact text with whitespace runs collapsed. */
function exactKey(text: string): string {
    return text.replace(/\s+/g, " ").trim()
}

const isHeadingBlock = (block: string) => HEADING.test(block) && !block.includes("\n")

/** Balanced: drops exact repeats of substantial blocks within a document. Returns the input as is when nothing repeats. */
export function dedupeExactBlocks(markdown: string): string {
    const blocks = splitBlocks(markdown)
    const seen = new Set<string>()
    const kept = blocks.filter((block) => {
        if (isHeadingBlock(block)) return true
        const key = exactKey(block)
        if (key.length < EXACT_MIN_BLOCK_CHARS) return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
    return kept.length === blocks.length ? markdown : kept.join("\n\n")
}

/** Removes inline markdown/HTML formatting (emphasis, links, images, code spans), keeping the text. */
export function stripInlineFormatting(text: string): string {
    const codes: string[] = []
    let s = text.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_m, _ticks, code: string) => {
        codes.push(code.trim())
        return `\u0000${codes.length - 1}\u0000`
    })
    s = s
        .replace(/_?\[Image: [^\]]*\]_?/g, "")
        .replace(/!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)/g, "")
        .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
        .replace(/\[\^[^\]]+\]/g, "")
        .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
        .replace(/<((?:https?|mailto):[^>\s]+)>/gi, "$1")
        .replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, "")
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
        .replace(/(^|[^\w*\\])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
        .replace(/(^|[^\w\\])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
        .replace(/\\([\\`*_{}[\]()|~])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
    return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]!).trim()
}

/** Splits a table row into cells, honouring escaped pipes. */
function tableCells(row: string): string[] {
    return row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(/(?<!\\)\|/)
        .map((c) => stripInlineFormatting(c.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, " ")))
}

/** One line outside code blocks in compact form, or null to drop it. */
function compactLine(raw: string): string | null {
    if (TABLE_ROW.test(raw)) {
        if (TABLE_DIVIDER.test(raw)) return null
        const cells = tableCells(raw).filter(Boolean)
        return cells.length ? `- ${cells.join(" · ")}` : null
    }
    if (RULE.test(raw)) return ""
    const line = raw.replace(/^\s*(>\s?)+/, "")
    const h = HEADING.exec(line)
    if (h) {
        const text = stripInlineFormatting(h[2]!.replace(/\s+#+\s*$/, ""))
        return text ? `${h[1]} ${text}` : ""
    }
    const li = LIST_ITEM.exec(line)
    if (li) {
        const text = stripInlineFormatting(li[3]!)
        if (!text) return null
        const ordered = /\d/.test(li[2]!)
        return `${" ".repeat(Math.min(li[1]!.length, 8))}${ordered ? li[2] : "-"} ${text}`
    }
    return stripInlineFormatting(line)
}

/** Keeps the first occurrence of each block (and list item) of a document; repeats are dropped. */
export function dedupeBlocks(markdown: string): string {
    const seenBlocks = new Set<string>()
    const seenItems = new Set<string>()
    const out: string[] = []
    for (const block of splitBlocks(markdown)) {
        if (isHeadingBlock(block)) {
            out.push(block)
            continue
        }
        const key = similarityKey(block)
        if (key.length >= MIN_DEDUP_KEY) {
            if (seenBlocks.has(key)) continue
            seenBlocks.add(key)
        }
        if (FENCE.test(block)) {
            out.push(block)
            continue
        }
        const lines = block.split("\n").filter((line) => {
            if (!LIST_ITEM.test(line)) return true
            const itemKey = similarityKey(line)
            if (itemKey.length < MIN_DEDUP_KEY * 2) return true
            if (seenItems.has(itemKey)) return false
            seenItems.add(itemKey)
            return true
        })
        if (lines.length) out.push(lines.join("\n"))
    }
    return out.join("\n\n")
}

/**
 * Compact markdown: keeps headings, lists and (truncated) code blocks; every other formatting is removed — tables become
 * lists, links keep their text, images, rules, quotes and HTML disappear. Repeated blocks are dropped.
 */
export function compactMarkdown(markdown: string): string {
    const out: string[] = []
    let fence: string | null = null
    let codeLines = 0
    for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
        const f = FENCE.exec(raw)
        if (fence) {
            if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) {
                if (codeLines > COMPACT_MAX_CODE_LINES) out.push("…")
                out.push(raw.trim())
                fence = null
                continue
            }
            if (++codeLines <= COMPACT_MAX_CODE_LINES) out.push(raw)
            continue
        }
        if (f) {
            fence = f[1]!
            codeLines = 0
            out.push(raw.trim())
            continue
        }
        const line = compactLine(raw)
        if (line !== null) out.push(line.trimEnd())
    }
    const text = out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    return dedupeBlocks(text)
}

/** Applies the preset to the markdown of one fetched document: compact simplifies it, balanced drops exact repeats. */
export function refineMarkdown(markdown: string, detail: IngestDetail): string {
    if (detail === "compact") return compactMarkdown(markdown)
    if (detail === "balanced") return dedupeExactBlocks(markdown)
    return markdown
}

/**
 * Substantial blocks repeated across documents of a source (site footers, shared sections, legal boilerplate) are kept
 * only in the first document by ref, so the result doesn't depend on fetch order.
 */
export function dedupeAcrossDocuments<T extends {ref: string; markdown: string}>(docs: T[], mode: DedupeMode = "similar"): T[] {
    const keyOf = (block: string) => {
        if (isHeadingBlock(block)) return ""
        const key = mode === "exact" ? exactKey(block) : similarityKey(block)
        return key.length >= (mode === "exact" ? EXACT_MIN_CROSS_BLOCK_CHARS : MIN_CROSS_DEDUP_KEY) ? key : ""
    }
    const owner = new Map<string, string>()
    for (const doc of [...docs].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))) {
        for (const block of splitBlocks(doc.markdown)) {
            const key = keyOf(block)
            if (key && !owner.has(key)) owner.set(key, doc.ref)
        }
    }
    return docs.map((doc) => {
        const blocks = splitBlocks(doc.markdown)
        const kept = blocks.filter((block) => {
            const key = keyOf(block)
            return !key || owner.get(key) === doc.ref
        })
        return kept.length === blocks.length ? doc : {...doc, markdown: kept.join("\n\n")}
    })
}

/**
 * Drops lines repeated on most pages of a PDF (letterheads, footers, page numbers), keeping their first occurrence.
 * `similar` ignores digits, so "Page 2 of 9" and "Page 3 of 9" count as the same line; `exact` only drops identical long
 * lines found on nearly every page.
 */
export function dropRepeatedPageLines(pages: string[], mode: DedupeMode = "similar"): string[] {
    const filled = pages.filter((p) => p.trim()).length
    if (filled < 3) return pages
    const keyOf =
        mode === "exact"
            ? (line: string) => (exactKey(line).length >= EXACT_MIN_PAGE_LINE_CHARS ? exactKey(line) : "")
            : (line: string) => similarityKey(line.replace(/\d+/g, "#"))
    const counts = new Map<string, number>()
    for (const page of pages) {
        for (const key of new Set(page.split("\n").map(keyOf))) {
            if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
        }
    }
    const threshold = Math.max(3, Math.ceil(filled * (mode === "exact" ? EXACT_MIN_PAGE_RATIO : 0.5)))
    const kept = new Set<string>()
    return pages.map((page) =>
        page
            .split("\n")
            .filter((line) => {
                const key = keyOf(line)
                if (!key || (counts.get(key) ?? 0) < threshold) return true
                if (kept.has(key)) return false
                kept.add(key)
                return true
            })
            .join("\n")
    )
}
