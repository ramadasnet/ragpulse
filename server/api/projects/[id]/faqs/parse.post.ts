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

    // Tolerates chatter and markdown fences around the JSON, and a single object instead of an array
    const match = res.content.match(/\[[\s\S]*\]/) ?? res.content.match(/\{[\s\S]*\}/)
    let drafts: FaqDraft[] = []
    if (match) {
        try {
            drafts = parseFaqJson(match[0]).items
        } catch {
            // Unusable model reply: reported as an empty list
        }
    }
    const items = drafts.flatMap((x) => {
        const r = faqInputSchema.safeParse(x)
        return r.success ? [r.data] : []
    })
    return {items: items.slice(0, 1000)}
})
