// Office files (docx, pptx, xlsx, csv) → Markdown. Pure module (no Nuxt auto-imports).
import {unzipSync} from "fflate"
import {DOMParser} from "linkedom"
import {DOCX_MIME, PPTX_MIME, XLSX_MIME} from "./binary"
import type {BinaryFile, ExtractResult} from "./types"

const MAX_ZIP_ENTRIES = 10_000
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024
/** Data rows of a Markdown table are split into blocks of roughly this size, each repeating the header */
const TABLE_BLOCK_CHARS = 1500
const XLSX_MAX_ROWS = 10_000
const XLSX_MAX_CELLS = 200_000

// ---------- tiny XML helpers (linkedom in XML mode keeps namespaced tag names) ----------

type Xml = any

const xmlDecoder = new TextDecoder()

function parseXml(data: Uint8Array | string | undefined): Xml | undefined {
    if (!data) return undefined
    try {
        const doc = new DOMParser().parseFromString(typeof data === "string" ? data : xmlDecoder.decode(data), "text/xml")
        return doc?.documentElement ? doc : undefined
    } catch {
        return undefined
    }
}

const els = (node: Xml, tag: string): Xml[] => (node?.getElementsByTagName ? Array.from(node.getElementsByTagName(tag)) : [])
const kids = (node: Xml): Xml[] => (node?.childNodes ? Array.from(node.childNodes).filter((n: Xml) => n.nodeType === 1) : [])
const kidsOf = (node: Xml, tag: string): Xml[] => kids(node).filter((n) => n.nodeName === tag)
const kid = (node: Xml, tag: string): Xml | undefined => (node ? kidsOf(node, tag)[0] : undefined)
const at = (node: Xml, name: string): string | undefined => {
    const v = node?.getAttribute?.(name)
    return v == null ? undefined : v
}
const xtext = (node: Xml): string => String(node?.textContent ?? "")
const on = (el: Xml): boolean => !!el && at(el, "w:val") !== "false" && at(el, "w:val") !== "0"

interface Rel {
    target: string
    type: string
}

function parseRels(data: Uint8Array | undefined): Map<string, Rel> {
    const map = new Map<string, Rel>()
    const doc = parseXml(data)
    if (!doc) return map
    for (const rel of els(doc, "Relationship")) {
        const id = at(rel, "Id")
        const target = at(rel, "Target")
        if (id && target) map.set(id, {target, type: at(rel, "Type") ?? ""})
    }
    return map
}

/** Resolves a relationship target (relative to `baseDir`, or package-absolute) to a zip entry path. */
function resolveZipPath(baseDir: string, target: string): string {
    if (target.startsWith("/")) return target.slice(1)
    const out: string[] = []
    for (const p of `${baseDir}/${target}`.split("/")) {
        if (p === "..") out.pop()
        else if (p && p !== ".") out.push(p)
    }
    return out.join("/")
}

function coreTitle(files: Files): string | undefined {
    const doc = parseXml(files["docProps/core.xml"])
    const t = doc ? els(doc, "dc:title").map(xtext).join("").trim() : ""
    return t || undefined
}

// ---------- zip safety ----------

type Files = Record<string, Uint8Array>

type ZipResult = {files: Files} | {skipped: string}

function openZip(bytes: Uint8Array, kind: string, needed: (name: string) => boolean): ZipResult {
    const entries: Array<{name: string; size: number}> = []
    try {
        unzipSync(bytes, {
            filter: (f) => {
                entries.push({name: f.name, size: f.originalSize})
                return false
            }
        })
    } catch (err: any) {
        return {skipped: `unreadable ${kind} (${String(err?.message || err).slice(0, 80)})`}
    }
    if (entries.length > MAX_ZIP_ENTRIES) return {skipped: `unreadable ${kind} (more than ${MAX_ZIP_ENTRIES} entries)`}
    const wanted = new Set(entries.filter((e) => needed(e.name)).map((e) => e.name))
    const total = entries.reduce((sum, e) => sum + (wanted.has(e.name) ? e.size : 0), 0)
    if (total > MAX_UNZIPPED_BYTES) return {skipped: `unreadable ${kind} (expands beyond ${MAX_UNZIPPED_BYTES / 1024 / 1024} MB)`}
    try {
        return {files: unzipSync(bytes, {filter: (f) => wanted.has(f.name)})}
    } catch (err: any) {
        return {skipped: `unreadable ${kind} (${String(err?.message || err).slice(0, 80)})`}
    }
}

// ---------- shared Markdown table rendering (docx, pptx, xlsx, csv) ----------

const escCell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r\n?|\n/g, "<br>").trim()

/** Renders `header` + rows as Markdown table blocks; every block repeats the header (the chunker splits on blank lines). */
function renderTable(header: string[], rows: string[][]): string {
    const cols = Math.max(header.length, ...rows.map((r) => r.length))
    const all = [header, ...rows]
    if (cols < 2) return all.flat().map((s) => s.trim()).filter(Boolean).join("\n")
    const pad = (r: string[]) => Array.from({length: cols}, (_, i) => escCell(r[i] ?? ""))
    const line = (r: string[]) => `| ${pad(r).join(" | ")} |`
    const sep = `| ${Array.from({length: cols}, () => "---").join(" | ")} |`
    const blocks: string[] = []
    let block = [line(header), sep]
    let size = block.join("\n").length
    for (const row of rows) {
        const l = line(row)
        if (size + l.length > TABLE_BLOCK_CHARS && block.length > 2) {
            blocks.push(block.join("\n"))
            block = [line(header), sep, l]
            size = block.join("\n").length
        } else {
            block.push(l)
            size += l.length + 1
        }
    }
    blocks.push(block.join("\n"))
    return blocks.join("\n\n")
}

// ---------- docx ----------

interface DocxCtx {
    styles: Map<string, {name: string; outline?: number}>
    numFmts: Map<string, Map<number, string>>
    rels: Map<string, Rel>
}

interface Seg {
    text: string
    bold: boolean
    italic: boolean
    link?: string
}

function runProps(r: Xml): {bold: boolean; italic: boolean} {
    const rpr = kid(r, "w:rPr")
    return {bold: on(kid(rpr, "w:b")), italic: on(kid(rpr, "w:i"))}
}

/** Text of `w:txbxContent` boxes inside a drawing/picture (included once, images themselves ignored). */
function textBoxText(node: Xml, ctx: DocxCtx): string {
    const parts: string[] = []
    for (const box of els(node, "w:txbxContent")) {
        for (const p of els(box, "w:p")) {
            const segs: Seg[] = []
            collectRuns(p, ctx, segs)
            const t = segs.map((s) => s.text).join("").trim()
            if (t) parts.push(t)
        }
    }
    return parts.length ? ` ${parts.join(" ")} ` : ""
}

function collectRun(r: Xml, ctx: DocxCtx, segs: Seg[], link?: string): void {
    const {bold, italic} = runProps(r)
    let buf = ""
    const flush = () => {
        if (buf) segs.push({text: buf, bold, italic, ...(link ? {link} : {})})
        buf = ""
    }
    for (const c of kids(r)) {
        const name = c.nodeName
        if (name === "w:t") buf += xtext(c)
        else if (name === "w:tab") buf += " "
        else if (name === "w:br" || name === "w:cr") buf += "\n"
        else if (name === "w:noBreakHyphen") buf += "-"
        else if (name === "w:drawing" || name === "w:pict" || name === "w:object") buf += textBoxText(c, ctx)
        // w:rPr, w:delText, w:instrText, w:fldChar, w:sym and anything else is skipped
    }
    flush()
}

const safeUrl = (u: string) => u.replace(/[()\s]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : "%20"))

function collectRuns(node: Xml, ctx: DocxCtx, segs: Seg[], link?: string): void {
    for (const c of kids(node)) {
        const name = c.nodeName
        if (name === "w:r") collectRun(c, ctx, segs, link)
        else if (name === "w:hyperlink") {
            const rid = at(c, "r:id")
            const target = rid ? ctx.rels.get(rid)?.target : undefined
            collectRuns(c, ctx, segs, target && /^https?:/i.test(target) ? safeUrl(target) : undefined)
        } else if (name === "w:del" || name === "w:moveFrom" || name === "mc:Fallback" || name === "w:pPr") continue
        else if (name === "mc:AlternateContent") {
            for (const choice of kidsOf(c, "mc:Choice")) collectRuns(choice, ctx, segs, link)
        } else if (name === "w:sdt") {
            const content = kid(c, "w:sdtContent")
            if (content) collectRuns(content, ctx, segs, link)
        } else if (name === "w:bookmarkStart" || name === "w:bookmarkEnd" || name === "w:proofErr") continue
        else collectRuns(c, ctx, segs, link) // w:ins, w:smartTag, w:customXml, w:fldSimple, unknown wrappers
    }
}

function emitSegs(segs: Seg[]): string {
    const merged: Seg[] = []
    for (const s of segs) {
        const last = merged[merged.length - 1]
        if (last && last.bold === s.bold && last.italic === s.italic && last.link === s.link) last.text += s.text
        else merged.push({...s})
    }
    return merged
        .map((s) => {
            if (!s.text.trim()) return s.text
            const lead = /^\s+/.exec(s.text)?.[0] ?? ""
            const trail = /\s+$/.exec(s.text)?.[0] ?? ""
            let t = s.text.trim()
            if (s.bold) t = `**${t}**`
            if (s.italic) t = `_${t}_`
            if (s.link) t = `[${t}](${s.link})`
            return lead + t + trail
        })
        .join("")
}

function docxParagraphText(p: Xml, ctx: DocxCtx): string {
    const segs: Seg[] = []
    collectRuns(p, ctx, segs)
    return emitSegs(segs).trim()
}

function docxParagraph(p: Xml, ctx: DocxCtx): string {
    const t = docxParagraphText(p, ctx)
    if (!t) return ""
    const ppr = kid(p, "w:pPr")
    const styleId = at(kid(ppr, "w:pStyle"), "w:val")
    const style = styleId ? ctx.styles.get(styleId) : undefined
    const name = style?.name ?? ""
    const heading = /^heading\s*(\d)/i.exec(name)?.[1] ?? (styleId ? /^heading\s*(\d)/i.exec(styleId)?.[1] : undefined)
    if (name === "title" || styleId === "Title") return `# ${t}`
    if (heading) return `${"#".repeat(Math.min(6, Number(heading)))} ${t}`
    const outline = at(kid(ppr, "w:outlineLvl"), "w:val") ?? (style?.outline !== undefined ? String(style.outline) : undefined)
    if (outline !== undefined && Number.isFinite(Number(outline))) return `${"#".repeat(Math.min(6, Number(outline) + 1))} ${t}`
    const numPr = kid(ppr, "w:numPr")
    if (numPr) {
        const ilvl = Math.max(0, Number(at(kid(numPr, "w:ilvl"), "w:val") ?? 0) || 0)
        const numId = at(kid(numPr, "w:numId"), "w:val")
        const fmt = numId ? ctx.numFmts.get(numId)?.get(ilvl) : undefined
        return `${"  ".repeat(ilvl)}${!fmt || fmt === "bullet" ? "-" : "1."} ${t}`
    }
    return t
}

/** Text parts of a table cell: paragraphs plus nested tables flattened to text. */
function cellParts(el: Xml, ctx: DocxCtx): string[] {
    const parts: string[] = []
    for (const c of kids(el)) {
        const name = c.nodeName
        if (name === "w:p") {
            const t = docxParagraphText(c, ctx)
            if (t) parts.push(t)
        } else if (name === "w:tbl") {
            const t = els(c, "w:p").map((p) => docxParagraphText(p, ctx)).filter(Boolean).join(" ")
            if (t) parts.push(t)
        } else if (name === "w:sdt") {
            const content = kid(c, "w:sdtContent")
            if (content) parts.push(...cellParts(content, ctx))
        }
    }
    return parts
}

function docxTable(tbl: Xml, ctx: DocxCtx): string {
    const rows: string[][] = []
    for (const tr of kidsOf(tbl, "w:tr")) {
        const row: string[] = []
        for (const tc of kidsOf(tr, "w:tc")) {
            row.push(cellParts(tc, ctx).join("<br>"))
            const span = Math.max(1, Number(at(kid(kid(tc, "w:tcPr"), "w:gridSpan"), "w:val") ?? 1) || 1)
            for (let i = 1; i < span; i++) row.push("")
        }
        if (row.length) rows.push(row)
    }
    return rows.length ? renderTable(rows[0]!, rows.slice(1)) : ""
}

function docxToMarkdown(files: Files): ExtractResult {
    const doc = parseXml(files["word/document.xml"])
    if (!doc) return {skipped: "unreadable docx (missing word/document.xml)"}
    const ctx: DocxCtx = {styles: new Map(), numFmts: new Map(), rels: parseRels(files["word/_rels/document.xml.rels"])}

    const stylesDoc = parseXml(files["word/styles.xml"])
    if (stylesDoc) {
        for (const st of els(stylesDoc, "w:style")) {
            if (at(st, "w:type") !== "paragraph") continue
            const id = at(st, "w:styleId")
            if (!id) continue
            const outline = Number(at(kid(kid(st, "w:pPr"), "w:outlineLvl"), "w:val"))
            ctx.styles.set(id, {name: (at(kid(st, "w:name"), "w:val") ?? "").toLowerCase(), ...(Number.isFinite(outline) ? {outline} : {})})
        }
    }

    const numDoc = parseXml(files["word/numbering.xml"])
    if (numDoc) {
        const abstracts = new Map<string, Map<number, string>>()
        for (const an of els(numDoc, "w:abstractNum")) {
            const id = at(an, "w:abstractNumId")
            const lvls = new Map<number, string>()
            for (const lvl of kidsOf(an, "w:lvl")) {
                const fmt = at(kid(lvl, "w:numFmt"), "w:val")
                if (fmt) lvls.set(Number(at(lvl, "w:ilvl") ?? 0) || 0, fmt)
            }
            if (id) abstracts.set(id, lvls)
        }
        for (const num of els(numDoc, "w:num")) {
            const numId = at(num, "w:numId")
            const lvls = ctx.numFmts.get(numId!) ?? abstracts.get(at(kid(num, "w:abstractNumId"), "w:val") ?? "")
            if (numId && lvls) ctx.numFmts.set(numId, lvls)
        }
    }

    const body = els(doc, "w:body")[0]
    if (!body) return {skipped: "no readable content"}
    const blocks: string[] = []
    const walk = (el: Xml) => {
        for (const c of kids(el)) {
            const name = c.nodeName
            if (name === "w:p") {
                const t = docxParagraph(c, ctx)
                if (t) blocks.push(t)
            } else if (name === "w:tbl") {
                const t = docxTable(c, ctx)
                if (t) blocks.push(t)
            } else if (name === "w:sdt") {
                const content = kid(c, "w:sdtContent")
                if (content) walk(content)
            } else if (name === "mc:AlternateContent") {
                for (const choice of kidsOf(c, "mc:Choice")) walk(choice)
            }
        }
    }
    walk(body)
    const markdown = blocks.join("\n\n")
    if (!markdown.trim()) return {skipped: "no readable content"}
    const title = coreTitle(files)
    return {markdown, ...(title ? {title} : {})}
}

// ---------- pptx ----------

const SKIP_PH = new Set(["sldNum", "dt", "ftr", "hdr"])
const TITLE_PH = new Set(["title", "ctrTitle"])
const BODY_PH = new Set(["body", "obj"])

function pptxParagraphText(p: Xml): string {
    let t = ""
    for (const c of kids(p)) {
        const name = c.nodeName
        if (name === "a:r" || name === "a:fld") t += els(c, "a:t").map(xtext).join("")
        else if (name === "a:br") t += "\n"
    }
    return t.trim()
}

/** Paragraph lines of a `p:txBody`: bullets for body/content placeholders and bulleted lists. */
function pptxParagraphs(txBody: Xml, bodyPh: boolean): string[] {
    const lines: string[] = []
    for (const p of kidsOf(txBody, "a:p")) {
        const ppr = kid(p, "a:pPr")
        const lvl = Math.max(0, Number(at(ppr, "lvl") ?? 0) || 0)
        const buNone = !!kid(ppr, "a:buNone")
        const hasBullet = !!kid(ppr, "a:buChar") || !!kid(ppr, "a:buAutoNum")
        const t = pptxParagraphText(p)
        if (!t) continue
        lines.push(!buNone && (bodyPh || hasBullet) ? `${"  ".repeat(lvl)}- ${t}` : t)
    }
    return lines
}

function pptxTable(frame: Xml): string {
    const tbl = els(frame, "a:tbl")[0]
    if (!tbl) return ""
    const rows: string[][] = []
    for (const tr of kidsOf(tbl, "a:tr")) {
        const row = kidsOf(tr, "a:tc").map((tc) => els(tc, "a:p").map(pptxParagraphText).filter(Boolean).join("<br>"))
        if (row.some((c) => c.trim())) rows.push(row)
    }
    return rows.length ? renderTable(rows[0]!, rows.slice(1)) : ""
}

function slideShapes(el: Xml, out: {title?: string; blocks: string[]}): void {
    for (const c of kids(el)) {
        const name = c.nodeName
        if (name === "p:sp" || name === "p:cxnSp") {
            const ph = els(c, "p:ph")[0]
            const phType = ph ? (at(ph, "type") ?? "body") : ""
            if (SKIP_PH.has(phType)) continue
            const txBody = els(c, "p:txBody")[0]
            if (!txBody) continue
            const t = pptxParagraphs(txBody, !!ph && BODY_PH.has(phType)).filter(Boolean).join("\n").trim()
            if (!t) continue
            if (TITLE_PH.has(phType)) {
                if (!out.title) out.title = t.replace(/\s*\n\s*/g, " ")
            } else {
                out.blocks.push(t)
            }
        } else if (name === "p:grpSp") {
            slideShapes(c, out)
        } else if (name === "p:graphicFrame") {
            const t = pptxTable(c)
            if (t) out.blocks.push(t)
        }
    }
}

/** Speaker notes: the text of the `body` placeholder of the notes slide. */
function pptxNotes(files: Files, path: string): string {
    const doc = parseXml(files[path])
    if (!doc) return ""
    for (const sp of els(doc, "p:sp")) {
        const ph = els(sp, "p:ph")[0]
        if (at(ph, "type") !== "body") continue
        const txBody = els(sp, "p:txBody")[0]
        const t = txBody ? pptxParagraphs(txBody, false).filter(Boolean).join("\n") : ""
        if (t.trim()) return t
    }
    return ""
}

function pptxToMarkdown(files: Files): ExtractResult {
    const pres = parseXml(files["ppt/presentation.xml"])
    if (!pres) return {skipped: "unreadable pptx (missing ppt/presentation.xml)"}
    const rels = parseRels(files["ppt/_rels/presentation.xml.rels"])
    const out: string[] = []
    const sldIdLst = els(pres, "p:sldIdLst")[0]
    const slideIds = sldIdLst ? kidsOf(sldIdLst, "p:sldId") : els(pres, "p:sldId")
    slideIds.forEach((sld, i) => {
        const rid = at(sld, "r:id")
        const rel = rid ? rels.get(rid) : undefined
        if (!rel || at(sld, "show") === "0") return
        const path = resolveZipPath("ppt", rel.target)
        const doc = parseXml(files[path])
        if (!doc || at(doc.documentElement, "show") === "0") return
        const spTree = els(doc, "p:spTree")[0]
        if (!spTree) return
        const slide: {title?: string; blocks: string[]} = {blocks: []}
        slideShapes(spTree, slide)
        const parts = [`## Slide ${i + 1}${slide.title ? `: ${slide.title}` : ""}`]
        if (slide.blocks.length) parts.push(slide.blocks.join("\n\n"))
        const slideRels = parseRels(files[`ppt/slides/_rels/${path.split("/").pop()}.rels`])
        const notesRel = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"))
        const notes = notesRel ? pptxNotes(files, resolveZipPath("ppt/slides", notesRel.target)) : ""
        if (notes) parts.push(`### Notes\n\n${notes}`)
        out.push(parts.join("\n\n"))
    })
    const markdown = out.join("\n\n")
    if (!markdown.trim()) return {skipped: "no readable content"}
    const title = coreTitle(files)
    return {markdown, ...(title ? {title} : {})}
}

// ---------- xlsx ----------

const DATE_BUILTIN_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

interface XlsxCtx {
    shared: string[]
    cellXfs: number[]
    customFmts: Map<number, string>
    date1904: boolean
    cellsUsed: number
}

/** numFmt code without quoted literals and [bracketed] sections (colors, conditions, locale). */
const stripFmt = (code: string) => code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "")
const trimNum = (n: number) => Number(n.toPrecision(15))

function excelDate(serial: number, ctx: XlsxCtx, numFmtId: number): string {
    const epoch = ctx.date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
    const d = new Date(epoch + Math.round(serial * 86400_000))
    const pad = (n: number) => String(n).padStart(2, "0")
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    const hasTime = serial % 1 !== 0 || /[hs]/i.test(stripFmt(ctx.customFmts.get(numFmtId) ?? ""))
    return hasTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

function cellText(c: Xml, ctx: XlsxCtx): string {
    const t = at(c, "t")
    const v = kid(c, "v")
    if (t === "s") return v ? (ctx.shared[Number(xtext(v))] ?? "") : ""
    if (t === "inlineStr") return els(kid(c, "is") ?? c, "t").map(xtext).join("")
    if (t === "str") return v ? xtext(v) : ""
    if (t === "b") return v ? (xtext(v) === "1" || xtext(v).toLowerCase() === "true" ? "TRUE" : "FALSE") : ""
    if (t === "e") return v ? xtext(v) : ""
    if (!v) return ""
    const raw = xtext(v)
    const n = Number(raw)
    if (!Number.isFinite(n)) return raw
    const numFmtId = ctx.cellXfs[Number(at(c, "s") ?? 0) || 0] ?? 0
    if (DATE_BUILTIN_FMTS.has(numFmtId) || /[ymdhs]/i.test(stripFmt(ctx.customFmts.get(numFmtId) ?? ""))) return excelDate(n, ctx, numFmtId)
    const code = stripFmt(ctx.customFmts.get(numFmtId) ?? "")
    if (numFmtId === 9 || numFmtId === 10 || code.includes("%")) return `${trimNum(n * 100)}%`
    return String(trimNum(n))
}

const colIndex = (ref: string): number | undefined => {
    const m = /^([A-Za-z]+)/.exec(ref)
    if (!m) return undefined
    let n = 0
    for (const ch of m[1]!.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
    return n - 1
}

interface SheetData {
    name: string
    markdown: string
}

function xlsxSheet(name: string, doc: Xml, ctx: XlsxCtx): SheetData | undefined {
    const rowEls = els(doc, "sheetData")[0] ? kidsOf(els(doc, "sheetData")[0], "row") : els(doc, "row")
    const total = rowEls.length
    const rows: string[][] = []
    let processed = 0
    for (const row of rowEls) {
        if (rows.length >= XLSX_MAX_ROWS || ctx.cellsUsed >= XLSX_MAX_CELLS) break
        const cells = new Map<number, string>()
        let nextCol = 0
        for (const c of kidsOf(row, "c")) {
            if (ctx.cellsUsed >= XLSX_MAX_CELLS) break
            const col = colIndex(at(c, "r") ?? "") ?? nextCol
            nextCol = col + 1
            const v = cellText(c, ctx)
            ctx.cellsUsed++
            if (v.trim()) cells.set(col, v)
        }
        if (cells.size) {
            const cols = [...cells.keys()]
            rows.push(Array.from({length: Math.max(...cols) + 1}, (_, i) => cells.get(i) ?? ""))
        }
        processed++
    }
    if (!rows.length) return undefined
    // Fully-empty rows were never stored; drop columns that are empty in every stored row
    const cols = Math.max(...rows.map((r) => r.length))
    const keep = Array.from({length: cols}, (_, i) => rows.some((r) => (r[i] ?? "").trim()))
    const matrix = rows.map((r) => r.filter((_, i) => keep[i])).filter((r) => r.some((c) => c.trim()))
    if (!matrix.length) return undefined
    const parts = [`## ${name}`, renderTable(matrix[0]!, matrix.slice(1))]
    const remaining = total - processed
    if (remaining > 0) parts.push(`_(${remaining} more row${remaining === 1 ? "" : "s"} not indexed)_`)
    return {name, markdown: parts.join("\n\n")}
}

function xlsxToMarkdown(files: Files): ExtractResult {
    const wb = parseXml(files["xl/workbook.xml"])
    if (!wb) return {skipped: "unreadable xlsx (missing xl/workbook.xml)"}
    const ctx: XlsxCtx = {
        shared: [],
        cellXfs: [],
        customFmts: new Map(),
        date1904: ["1", "true"].includes(at(els(wb, "workbookPr")[0], "date1904") ?? ""),
        cellsUsed: 0
    }
    const sst = parseXml(files["xl/sharedStrings.xml"])
    if (sst) {
        for (const si of els(sst, "si")) {
            ctx.shared.push(kidsOf(si, "t").map(xtext).join("") || kidsOf(si, "r").map((r) => els(r, "t").map(xtext).join("")).join(""))
        }
    }
    const styles = parseXml(files["xl/styles.xml"])
    if (styles) {
        for (const nf of els(styles, "numFmt")) {
            const id = Number(at(nf, "numFmtId"))
            const code = at(nf, "formatCode")
            if (Number.isFinite(id) && code) ctx.customFmts.set(id, code)
        }
        const xfs = els(styles, "cellXfs")[0]
        if (xfs) for (const xf of kidsOf(xfs, "xf")) ctx.cellXfs.push(Number(at(xf, "numFmtId") ?? 0) || 0)
    }
    const rels = parseRels(files["xl/_rels/workbook.xml.rels"])
    const sheets: string[] = []
    for (const sheet of els(wb, "sheet")) {
        const state = at(sheet, "state")
        if (state === "hidden" || state === "veryHidden") continue
        const rid = at(sheet, "r:id")
        const target = rid ? rels.get(rid)?.target : undefined
        if (!target) continue
        const doc = parseXml(files[resolveZipPath("xl", target)])
        if (!doc) continue
        const data = xlsxSheet(at(sheet, "name") || "Sheet", doc, ctx)
        if (data) sheets.push(data.markdown)
    }
    const markdown = sheets.join("\n\n")
    if (!markdown.trim()) return {skipped: "no readable content"}
    const title = coreTitle(files)
    return {markdown, ...(title ? {title} : {})}
}

// ---------- csv (RFC 4180) ----------

const CSV_DELIMITERS = [";", "\t", ","]

function detectDelimiter(text: string): string {
    let inQuotes = false
    const counts = new Map<string, number>(CSV_DELIMITERS.map((d) => [d, 0]))
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') i++
            else if (c === '"') inQuotes = false
            continue
        }
        if (c === '"') inQuotes = true
        else if (c === "\n" || c === "\r") break
        else if (counts.has(c)) counts.set(c, counts.get(c)! + 1)
    }
    let best = ","
    let bestCount = 0
    for (const d of CSV_DELIMITERS) {
        if (counts.get(d)! > bestCount) {
            best = d
            bestCount = counts.get(d)!
        }
    }
    return best
}

function parseCsv(text: string, delimiter?: string): string[][] {
    const d = delimiter ?? detectDelimiter(text)
    const rows: string[][] = []
    let row: string[] = []
    let field = ""
    let inQuotes = false
    const pushRow = () => {
        row.push(field)
        field = ""
        rows.push(row)
        row = []
    }
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"'
                    i++
                } else {
                    inQuotes = false
                }
            } else {
                field += c
            }
            continue
        }
        if (c === '"') inQuotes = true
        else if (c === d) {
            row.push(field)
            field = ""
        } else if (c === "\n") {
            pushRow()
        } else if (c === "\r") {
            if (text[i + 1] === "\n") i++
            pushRow()
        } else {
            field += c
        }
    }
    if (field || row.length) pushRow()
    return rows.filter((r) => r.some((f) => f.trim()))
}

/** RFC 4180 CSV/TSV → a Markdown table (first row is the header). Auto-detects `;`, tab or `,`. */
export function csvToMarkdown(text: string, delimiter?: string): string {
    const rows = parseCsv(text.replace(/^\uFEFF/, ""), delimiter).map((r) => r.map((c) => c.trim()))
    if (!rows.length) return ""
    const capped = rows.slice(0, XLSX_MAX_ROWS)
    const table = renderTable(capped[0]!, capped.slice(1))
    const remaining = rows.length - capped.length
    return remaining ? `${table}\n\n_(${remaining} more row${remaining === 1 ? "" : "s"} not indexed)_` : table
}

// ---------- entry point ----------

const OFFICE_ENTRIES: Record<string, (name: string) => boolean> = {
    docx: (name) => name === "word/document.xml" || name === "word/styles.xml" || name === "word/numbering.xml" || name === "word/_rels/document.xml.rels" || name === "docProps/core.xml",
    pptx: (name) =>
        name === "ppt/presentation.xml" ||
        name === "ppt/_rels/presentation.xml.rels" ||
        /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
        /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name) ||
        /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name) ||
        name === "docProps/core.xml",
    xlsx: (name) => name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml" || name === "xl/styles.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(name) || name === "docProps/core.xml"
}

/** Converts a docx/pptx/xlsx file to Markdown. Never throws: bad input yields `{skipped}`. */
export function officeToMarkdown(file: BinaryFile): ExtractResult {
    const kind = file.mime === DOCX_MIME ? "docx" : file.mime === PPTX_MIME ? "pptx" : file.mime === XLSX_MIME ? "xlsx" : undefined
    if (!kind) return {skipped: `unsupported office type ${file.mime}`}
    const res = openZip(file.bytes, kind, OFFICE_ENTRIES[kind]!)
    if ("skipped" in res) return res
    const files = res.files
    try {
        return kind === "docx" ? docxToMarkdown(files) : kind === "pptx" ? pptxToMarkdown(files) : xlsxToMarkdown(files)
    } catch (err: any) {
        return {skipped: `unreadable ${kind} (${String(err?.message || err).slice(0, 80)})`}
    }
}
