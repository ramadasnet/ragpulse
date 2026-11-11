// PDFs, images and Office files → markdown: Office and PDF text layers are read locally, images and scanned PDFs go to an OpenRouter vision model.
import {createHash} from "node:crypto"
import {extractPdfText, imageSize, isOfficeMime, pdfToMarkdown, visibleLength} from "./binary"
import {officeToMarkdown} from "./office"
import type {BinaryFile, ExtractResult} from "./types"

const MIN_IMAGE_SIDE = 100
const MIN_IMAGE_PIXELS = 60_000
const MIN_PAGE_CHARS = 20
const MAX_VISION_PDF_PAGES = 50
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

function result(markdown: string, title?: string): ExtractResult {
    return markdown.trim() ? {markdown, ...(title ? {title} : {})} : {skipped: "no readable content"}
}

function unfence(text: string): string {
    return /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text)?.[1]?.trim() ?? text
}

async function visionToMarkdown(model: string, file: BinaryFile): Promise<string> {
    const isPdf = file.mime === "application/pdf"
    const data = `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}`
    const {content} = await chatCompletion({
        model,
        temperature: 0,
        maxTokens: isPdf ? 32_000 : 4000,
        messages: [
            {role: "system", content: isPdf ? PDF_PROMPT : IMAGE_PROMPT},
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
export function createBinaryExtractor(): (file: BinaryFile) => Promise<ExtractResult> {
    const config = useRuntimeConfig()
    const model = String(config.visionModel || "").trim()
    const maxPerSync = Math.max(0, Number(config.visionMaxPerSync) || 0)
    let used = 0

    const viaVision = async (file: BinaryFile, title?: string): Promise<ExtractResult> => {
        const kind = file.mime === "application/pdf" ? "scanned PDF" : "image"
        if (!model) return {skipped: `${kind}, no vision model configured (NUXT_VISION_MODEL)`}
        if (file.bytes.byteLength > MAX_VISION_BYTES) return {skipped: `${kind} larger than ${MAX_VISION_BYTES / 1024 / 1024} MB`}

        const {extractions} = await useCollections()
        const key = `${model}:${createHash("sha256").update(file.bytes).digest("hex")}`
        const cached = await extractions.findOneAndUpdate({_id: key}, {$set: {usedAt: new Date()}}, {projection: {markdown: 1}})
        if (cached) return result(cached.markdown, title)

        // Thrown, so previously indexed versions are kept until a later sync gets to them
        if (used >= maxPerSync) throw new Error(`vision limit of ${maxPerSync} files per sync reached, continues on the next sync`)
        used++
        const markdown = await visionToMarkdown(model, file)
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
            if (textPages * 2 >= pdf.pages.length) return result(pdfToMarkdown(pdf.pages), pdf.title)
            if (pdf.pages.length > MAX_VISION_PDF_PAGES) return {skipped: `scanned PDF with more than ${MAX_VISION_PDF_PAGES} pages`}
            return viaVision(file, pdf.title)
        }

        const size = imageSize(file.bytes)
        if (!size) return {skipped: "not a valid image"}
        if (Math.min(size.width, size.height) < MIN_IMAGE_SIDE || size.width * size.height < MIN_IMAGE_PIXELS) {
            return {skipped: `image too small (${size.width}×${size.height})`}
        }
        return viaVision(file)
    }
}
