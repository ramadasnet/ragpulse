import type {Faq} from "#shared/types"

const normalizeQuestion = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim()

/** Bulk import: skips questions that already exist, indexes the new entries (4 at a time). */
export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const body = await readIngestBody(event, faqImportInputSchema)
    const {faqs} = await useCollections()

    const existing = new Set((await faqs.find({projectId: project._id}, {projection: {question: 1}}).toArray()).map((f) => normalizeQuestion(f.question)))
    const now = Date.now()
    const created: Faq[] = []
    for (const item of body.items) {
        // Pasted HTML becomes Markdown before it is stored
        const question = faqTextToMarkdown(item.question)
        const answer = faqTextToMarkdown(item.answer)
        const key = normalizeQuestion(question)
        if (existing.has(key)) continue
        existing.add(key)
        // Distinct timestamps keep the pasted order in "newest first" listings
        const at = new Date(now + created.length)
        created.push({_id: newId(), projectId: project._id, question, answer, createdAt: at, updatedAt: at})
    }
    if (created.length) await faqs.insertMany(created)

    let indexErrors = 0
    let firstError: string | undefined
    const queue = [...created]
    await Promise.all(
        Array.from({length: 4}, async () => {
            while (queue.length) {
                const faq = queue.shift()!
                try {
                    await indexFaq(faq)
                } catch (err: any) {
                    indexErrors++
                    firstError ??= String(err?.statusMessage || err?.message || err).slice(0, 300)
                }
            }
        })
    )

    return {imported: created.length, skipped: body.items.length - created.length, indexErrors, ...(firstError ? {indexError: firstError} : {})}
})
