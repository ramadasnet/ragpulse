import type {Faq} from "#shared/types"
import {htmlFragmentToMarkdown} from "./ingest/markdown"

/** Known tags and entities: `a < b` or a literal `<promise>` are not treated as HTML. */
const HTML_MARKUP =
    /<\/?(a|abbr|article|aside|b|blockquote|br|button|caption|cite|code|dd|del|details|dfn|div|dl|dt|em|figcaption|figure|footer|form|h[1-6]|header|hr|i|iframe|img|input|ins|kbd|label|li|main|mark|nav|ol|option|p|pre|s|section|select|small|span|strike|strong|sub|summary|sup|svg|table|tbody|td|tfoot|th|thead|tr|u|ul|video)\b[^>]*>|<!--[\s\S]*?-->|&(?:amp|lt|gt|quot|apos|nbsp|#x?[0-9a-f]+);/i

/**
 * FAQ text is stored as Markdown: pasted HTML fragments are converted, plain text is kept.
 * The original text survives when the conversion would leave nothing.
 */
export function faqTextToMarkdown(text: string): string {
    if (!HTML_MARKUP.test(text)) return text
    return htmlFragmentToMarkdown(text) || text
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
