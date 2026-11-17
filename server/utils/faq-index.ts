import type {Faq} from "#shared/types"
import {htmlFragmentToMarkdown} from "./ingest/markdown"

/** Known tags and entities: `a < b` or a literal `<promise>` are not treated as HTML. */
const HTML_MARKUP =
    /<\/?(a|abbr|address|article|aside|audio|b|blockquote|body|br|button|canvas|caption|center|cite|code|col|colgroup|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|font|footer|form|h[1-6]|head|header|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|main|mark|nav|noscript|object|ol|optgroup|option|p|pre|q|rp|rt|ruby|s|script|section|select|small|source|span|strike|strong|style|sub|summary|sup|svg|table|tbody|td|template|textarea|tfoot|th|thead|title|tr|u|ul|video)\b[^>]*>|<!--[\s\S]*?-->|&(?:amp|lt|gt|quot|apos|nbsp|#x?[0-9a-f]+);/i

/** Fenced code blocks and inline code spans: literal text that must not be read as HTML. */
const CODE = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[`~]*[ \t]*(?=\n|$)|$)|(`+)(?!`)[^\n]*?[^`\n]\3(?!`)/g

/**
 * FAQ text is stored as Markdown: pasted HTML fragments are converted, plain text is kept.
 * Code blocks and spans are set aside first, so Markdown that mentions tags is left untouched.
 * The original text survives when the conversion would leave nothing.
 */
export function faqTextToMarkdown(text: string): string {
    const code: string[] = []
    const masked = text.replace(CODE, (m) => `zzfaqcode${code.push(m) - 1}zz`)
    if (!HTML_MARKUP.test(masked)) return text
    const converted = htmlFragmentToMarkdown(masked)
    if (!converted) return text
    return converted.replace(/zzfaqcode(\d+)zz/g, (_, i) => code[Number(i)] ?? "")
}

export function faqToMarkdown(faq: Pick<Faq, "question" | "answer">): string {
    return `Q: ${faq.question.trim()}\n\nA: ${faq.answer.trim()}`
}

/** (Re)indexes a single FAQ entry as one chunk. */
export async function indexFaq(faq: Faq): Promise<void> {
    const {chunks} = await useCollections()
    const content = faqToMarkdown(faq)
    const hash = sha256(content)
    const existing = await chunks.findOne({documentId: faq._id, sourceType: "faq"}, {projection: {hash: 1}})
    if (existing?.hash === hash) return
    const {embeddings, key} = await createEmbeddings([content])
    await chunks.deleteMany({documentId: faq._id, sourceType: "faq"})
    await chunks.insertOne({
        _id: newId(),
        projectId: faq.projectId,
        sourceId: faq._id,
        documentId: faq._id,
        sourceType: "faq",
        title: faq.question.slice(0, 200),
        heading: "FAQ",
        content,
        hash,
        embedding: embeddings[0]!,
        embeddingModel: key,
        tokens: estimateTokens(content),
        createdAt: new Date()
    })
}

export async function removeFaqIndex(faqId: string): Promise<void> {
    const {chunks} = await useCollections()
    await chunks.deleteMany({documentId: faqId, sourceType: "faq"})
}
