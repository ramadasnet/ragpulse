// PDF, image and Office helpers for ingestion. Pure module (no Nuxt auto-imports).
import {extractText, getDocumentProxy, getMeta} from "unpdf"

export const MAX_BINARY_BYTES = 20 * 1024 * 1024
const MAX_PDF_PAGES = 1000
const PDF_TIMEOUT_MS = 60_000

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export type BinaryMime = "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif" | typeof DOCX_MIME | typeof PPTX_MIME | typeof XLSX_MIME

const MIME_BY_EXT: Record<string, BinaryMime> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    docx: DOCX_MIME,
    pptx: PPTX_MIME,
    xlsx: XLSX_MIME
}
const MIME_ALIASES: Record<string, BinaryMime> = {"application/x-pdf": "application/pdf", "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg"}
const MIMES = new Set<string>(Object.values(MIME_BY_EXT))
const OFFICE_MIMES = new Set<string>([DOCX_MIME, PPTX_MIME, XLSX_MIME])

/** Word, PowerPoint or Excel file: converted locally, never sent to the vision model. */
export function isOfficeMime(mime: string): boolean {
    return OFFICE_MIMES.has(mime)
}

/** Supported PDF/image/Office type of a file name or URL path, by extension. */
export function binaryMimeFromName(name: string): BinaryMime | undefined {
    const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
    return ext ? MIME_BY_EXT[ext] : undefined
}

/** Supported PDF/image/Office type from a content type, falling back to the extension for generic types. */
export function binaryMimeFromType(type: string, path: string): BinaryMime | undefined {
    if (MIMES.has(type)) return type as BinaryMime
    if (MIME_ALIASES[type]) return MIME_ALIASES[type]
    if (!type || type === "application/octet-stream" || type === "binary/octet-stream") return binaryMimeFromName(path)
    return undefined
}

function ascii(b: Uint8Array, start: number, length: number): string {
    return String.fromCharCode(...b.subarray(start, start + length))
}

/** Pixel size from PNG, GIF, JPEG or WebP headers, undefined when the data isn't a recognized image. */
export function imageSize(b: Uint8Array): {width: number; height: number} | undefined {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    if (b.length >= 24 && ascii(b, 1, 3) === "PNG" && b[0] === 0x89) return {width: dv.getUint32(16), height: dv.getUint32(20)}
    if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") return {width: dv.getUint16(6, true), height: dv.getUint16(8, true)}
    if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
        const chunk = ascii(b, 12, 4)
        if (chunk === "VP8 " && b.length >= 30) return {width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff}
        if (chunk === "VP8L" && b.length >= 25) {
            const bits = dv.getUint32(21, true)
            return {width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1}
        }
        if (chunk === "VP8X" && b.length >= 30) return {width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16))}
        return undefined
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
        let i = 2
        while (i + 9 < b.length) {
            if (b[i] !== 0xff || b[i + 1] === 0xff) {
                i++
                continue
            }
            const marker = b[i + 1]!
            // SOFn frame headers carry the size (C4, C8 and CC are other segments)
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return {width: dv.getUint16(i + 7), height: dv.getUint16(i + 5)}
            }
            i += 2 + dv.getUint16(i + 2)
        }
    }
    return undefined
}

export interface PdfText {
    title?: string
    /** Text layer of each page */
    pages: string[]
}

let pdfQueue: Promise<unknown> = Promise.resolve()

/** Extracts the text layer of a PDF. PDFs are parsed one at a time to bound memory use. */
export function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
    const run = pdfQueue.then(() => withTimeout(readPdf(bytes), PDF_TIMEOUT_MS, "PDF parsing timed out"))
    pdfQueue = run.catch(() => {})
    return run
}

async function readPdf(bytes: Uint8Array): Promise<PdfText> {
    // pdf.js may detach the buffer it receives, callers still need theirs
    const pdf = await getDocumentProxy(bytes.slice(), {maxImageSize: 16_777_216})
    try {
        if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`more than ${MAX_PDF_PAGES} pages`)
        const [{text}, meta] = await Promise.all([extractText(pdf), getMeta(pdf).catch(() => null)])
        const title = meta?.info?.Title?.trim()
        return {...(title ? {title} : {}), pages: text}
    } finally {
        await pdf.loadingTask.destroy().catch(() => {})
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Joins page texts into markdown with a `## Page N` heading per page (used for citations). */
export function pdfToMarkdown(pages: string[]): string {
    const filled = pages.map((text, i) => ({text: text.trim(), page: i + 1})).filter((p) => p.text)
    if (pages.length === 1) return filled[0]?.text ?? ""
    return filled.map((p) => `## Page ${p.page}\n\n${p.text}`).join("\n\n")
}

/** Number of characters other than whitespace. */
export function visibleLength(text: string): number {
    return text.replace(/\s+/g, "").length
}
