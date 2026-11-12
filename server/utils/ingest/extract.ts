// PDFs, images and Office files → markdown: Office and PDF text layers are read locally, images and scanned PDFs go to an OpenRouter vision model.
import {createHash} from "node:crypto"
import type {IngestDetail} from "#shared/types"
import {extractPdfText, imageSize, isOfficeMime, pdfToMarkdown, visibleLength} from "./binary"
import {dropRepeatedPageLines} from "./detail"
import {officeToMarkdown} from "./office"
import type {BinaryFile, ExtractResult} from "./types"

const MIN_PAGE_CHARS = 20
// Base64 inflates by a third, providers cap inline request data around 20 MB
const MAX_VISION_BYTES = 10 * 1024 * 1024

const IMAGE_PROMPT = `You convert images from documentation into Markdown for a search index.
1. Transcribe all readable text verbatim, keeping its structure: headings, lists, tables as Markdown tables, code as fenced code blocks.
2. Then describe in a few sentences what the image shows beyond that text: e.g. which screen and controls a screenshot shows, how the parts of a diagram relate, the axes and trends of a chart.
Use the language of the text in the image. Do not guess beyond what is visible and do not add commentary.
If the image has no informative content (logo, icon, decoration, photo without text), reply with exactly: NONE`

const PDF_PROMPT = `You convert scanned PDF documents into Markdown for a search index.
Transcribe the text of every page verbatim and in reading order, keeping its structure: headings, lists, tables as Markdown tables.
Start each page with a "## Page N" heading. Briefly describe figures and diagrams where they appear.
Use the language of the document. Do not summarize, guess or add commentary.
If the document has no readable content, reply with exactly: NONE`

const IMAGE_PROMPT_COMPACT = `You convert images from documentation into Markdown for a compact search index.
Write only the essential information: the key text of the image (headings, labels, important values, short instructions) as plain text or a short list, then one sentence describing what the image shows.
Skip decorative text, repeated interface chrome and long fine print. Use the language of the text in the image. Do not guess beyond what is visible and do not add commentary.
If the image has no informative content (logo, icon, decoration, photo without text), reply with exactly: NONE`

const IMAGE_PROMPT_DETAILED = `You convert images from documentation into Markdown for a search index. Be thorough.
1. Transcribe all readable text verbatim, including small print, labels, tooltips and values, keeping its structure and styles: headings, lists, emphasis, tables as Markdown tables, code as fenced code blocks.
2. Then describe in detail what the image shows beyond that text: for screenshots the screen, its sections, controls and their state; for diagrams every element and how they relate; for charts the type, axes, units, series, notable values and trends.
Use the language of the text in the image. Do not guess beyond what is visible and do not add commentary.
If the image has no informative content (logo, icon, decoration, photo without text), reply with exactly: NONE`

const PDF_PROMPT_COMPACT = `You convert scanned PDF documents into Markdown for a compact search index.
Transcribe the main text in reading order, keeping only headings and lists as formatting. Skip letterheads, page headers and footers, page numbers, repeated boilerplate and decorative elements. Write tables as short lists. Mention figures in one short sentence at most.
Start each page with a "## Page N" heading. Use the language of the document. Do not summarize, guess or add commentary.
If the document has no readable content, reply with exactly: NONE`

const PDF_PROMPT_DETAILED = `You convert scanned PDF documents into Markdown for a search index. Be thorough.
Transcribe the text of every page verbatim and in reading order, including headers, footers, footnotes and small print, keeping its structure and styles: headings, lists, emphasis, tables as Markdown tables.
Start each page with a "## Page N" heading. Describe figures, diagrams, charts, stamps and signatures in detail where they appear.
Use the language of the document. Do not summarize, guess or add commentary.
If the document has no readable content, reply with exactly: NONE`

interface VisionPreset {
    minImageSide: number
    minImagePixels: number
    maxPdfPages: number
    imageTokens: number
    pdfTokens: number
    imagePrompt: string
    pdfPrompt: string
}

/** Images below the size limits are skipped as icons/decoration; compact skips more, detailed reads smaller images. */
const VISION_PRESETS: Record<IngestDetail, VisionPreset> = {
    compact: {minImageSide: 200, minImagePixels: 120_000, maxPdfPages: 20, imageTokens: 1500, pdfTokens: 16_000, imagePrompt: IMAGE_PROMPT_COMPACT, pdfPrompt: PDF_PROMPT_COMPACT},
    balanced: {minImageSide: 100, minImagePixels: 60_000, maxPdfPages: 50, imageTokens: 4000, pdfTokens: 32_000, imagePrompt: IMAGE_PROMPT, pdfPrompt: PDF_PROMPT},
    detailed: {minImageSide: 64, minImagePixels: 20_000, maxPdfPages: 50, imageTokens: 6000, pdfTokens: 32_000, imagePrompt: IMAGE_PROMPT_DETAILED, pdfPrompt: PDF_PROMPT_DETAILED}
}

function result(markdown: string, title?: string): ExtractResult {
    return markdown.trim() ? {markdown, ...(title ? {title} : {})} : {skipped: "no readable content"}
}

function unfence(text: string): string {
    return /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text)?.[1]?.trim() ?? text
}

async function visionToMarkdown(model: string, file: BinaryFile, preset: VisionPreset): Promise<string> {
    const isPdf = file.mime === "application/pdf"
    const data = `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}`
    const {content} = await chatCompletion({
        model,
        temperature: 0,
        maxTokens: isPdf ? preset.pdfTokens : preset.imageTokens,
        messages: [
            {role: "system", content: isPdf ? preset.pdfPrompt : preset.imagePrompt},
            {
                role: "user",
                content: [{type: "text", text: `File: ${file.name}`}, isPdf ? {type: "file", file: {filename: file.name, file_data: data}} : {type: "image_url", image_url: {url: data}}]
            }
        ]
    })
    const text = unfence(content.trim())
    return text === "NONE" ? "" : text
}

/** Creates the PDF/image extractor for one source sync (the vision budget is per sync). */
export function createBinaryExtractor(detail: IngestDetail = "balanced"): (file: BinaryFile) => Promise<ExtractResult> {
    const preset = VISION_PRESETS[detail]
    const config = useRuntimeConfig()
    const model = String(config.visionModel || "").trim()
    const maxPerSync = Math.max(0, Number(config.visionMaxPerSync) || 0)
    let used = 0

    const viaVision = async (file: BinaryFile, title?: string): Promise<ExtractResult> => {
        const kind = file.mime === "application/pdf" ? "scanned PDF" : "image"
        if (!model) return {skipped: `${kind}, no vision model configured (NUXT_VISION_MODEL)`}
        if (file.bytes.byteLength > MAX_VISION_BYTES) return {skipped: `${kind} larger than ${MAX_VISION_BYTES / 1024 / 1024} MB`}

        const {extractions} = await useCollections()
        const hash = createHash("sha256").update(file.bytes).digest("hex")
        const key = detail === "balanced" ? `${model}:${hash}` : `vision-${detail}:${model}:${hash}`
        const cached = await extractions.findOneAndUpdate({_id: key}, {$set: {usedAt: new Date()}}, {projection: {markdown: 1}})
        if (cached) return result(cached.markdown, title)

        // Thrown, so previously indexed versions are kept until a later sync gets to them
        if (used >= maxPerSync) throw new Error(`vision limit of ${maxPerSync} files per sync reached, continues on the next sync`)
        used++
        const markdown = await visionToMarkdown(model, file, preset)
        const now = new Date()
        await extractions.updateOne({_id: key}, {$set: {markdown, usedAt: now}, $setOnInsert: {createdAt: now}}, {upsert: true})
        return result(markdown, title)
    }

    return async (file) => {
        // Office files are converted locally: no vision budget is used for them
        if (isOfficeMime(file.mime)) return officeToMarkdown(file)
        if (file.mime === "application/pdf") {
            let pdf
            try {
                pdf = await extractPdfText(file.bytes)
            } catch (err: any) {
                return {skipped: `unreadable PDF (${String(err?.message || err).slice(0, 120)})`}
            }
            const textPages = pdf.pages.filter((p) => visibleLength(p) >= MIN_PAGE_CHARS).length
            if (textPages * 2 >= pdf.pages.length) {
                const pages = detail === "detailed" ? pdf.pages : dropRepeatedPageLines(pdf.pages, detail === "compact" ? "similar" : "exact")
                return result(pdfToMarkdown(pages), pdf.title)
            }
            if (pdf.pages.length > preset.maxPdfPages) return {skipped: `scanned PDF with more than ${preset.maxPdfPages} pages`}
            return viaVision(file, pdf.title)
        }

        const size = imageSize(file.bytes)
        if (!size) return {skipped: "not a valid image"}
        if (Math.min(size.width, size.height) < preset.minImageSide || size.width * size.height < preset.minImagePixels) {
            return {skipped: `image too small (${size.width}×${size.height})`}
        }
        return viaVision(file)
    }
}
