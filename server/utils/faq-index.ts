import type {Faq} from "#shared/types"

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
