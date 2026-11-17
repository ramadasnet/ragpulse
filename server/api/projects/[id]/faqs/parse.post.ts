import {parseFaqJson, type FaqDraft} from "#shared/utils/faq-import"

const PARSE_PROMPT = `You turn pasted content into FAQ entries for a knowledge base.

Reply with strict JSON only, no markdown fences: an array of objects like
[{"question": "...", "answer": "..."}]

Rules:
- Extract every question/answer pair you can find, in the input's original language.
- Keep the question and answer texts verbatim, Markdown is allowed.
- Reply with an empty array [] when nothing looks like a question/answer pair.`

/**
 * Import fallback: when the pasted text matches no known format, the project model extracts
 * the `{question, answer}` items. Entries failing the regular FAQ limits are dropped.
 */
export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "sources:manage")
    const body = await readIngestBody(event, faqParseInputSchema)
    if (!(await hasAiProvider())) throw createError({statusCode: 503, statusMessage: "No AI provider configured (Global Settings → AI Provider)"})

    const res = await chatCompletion({
        model: project.model,
        temperature: 0,
        maxTokens: 8000,
        signal: AbortSignal.timeout(120_000),
        messages: [
            {role: "system", content: PARSE_PROMPT},
            {role: "user", content: body.text}
        ]
    })

    // The whole reply first (a single entry object may contain [brackets]); otherwise tolerates chatter and markdown fences around the JSON
    let drafts: FaqDraft[] = []
    let ignored = 0
    for (const candidate of [res.content, res.content.match(/\[[\s\S]*\]/)?.[0], res.content.match(/\{[\s\S]*\}/)?.[0]]) {
        if (!candidate) continue
        try {
            const parsed = parseFaqJson(candidate)
            drafts = parsed.items
            ignored = parsed.invalid
            break
        } catch {
            // Try the next candidate; an unusable model reply is reported as an empty list
        }
    }
    const items = drafts.flatMap((x) => {
        const r = faqInputSchema.safeParse(x)
        return r.success ? [r.data] : []
    })
    ignored += drafts.length - items.length
    return {items: items.slice(0, 1000), ignored}
})
