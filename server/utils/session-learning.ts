// Self-learning knowledge: when a chat session is flagged as finished, conversations that had
// human (support agent) replies are summarized into a sanitized FAQ entry of the project, so the
// assistant can answer the same question next time. Personal and sensitive data is stripped both
// by prompt instructions and by the deterministic scrubber below.

import type {ChatMessage, ChatSession, Faq, Project} from "#shared/types"
import logger from "./logger"
import type {ReplyAuthor} from "./questions"

const TRANSCRIPT_CHARS = 24_000
const TRANSCRIPT_MESSAGES = 120
const ANSWER_MAX_CHARS = 8_000

const LEARN_PROMPT = `You turn finished support chat transcripts into a reusable FAQ entry for a knowledge base that an AI assistant uses to answer future visitors.

Reply with strict JSON only, no markdown fences, exactly one of:
{"question": "...", "answer": "..."}
or, when the conversation taught nothing reusable for other visitors (small talk, personal account issues, missing or "I don't know" answers):
{"skip": "one short reason"}

Rules:
- Only SUPPORT AGENT messages carry new knowledge; the AI assistant already knew its answers. Visitor messages provide the question context.
- The question is generic, phrased the way any visitor would ask it: no "I", "my", names or order references.
- The answer keeps only durable, reusable facts from the support agent's replies (policies, steps, links, explanations), in the conversation's language, Markdown allowed.
- Remove ALL personal and sensitive data: names, emails, phone numbers, addresses, order/account/ticket numbers, IPs, passwords and tokens. Refer to people only by role ("the visitor", "the support agent"). Details that only apply to this one visitor are left out.
- One entry only: when several topics came up, pick the most valuable one.`

export interface SessionLearnResult {
    faq?: Faq
    /** Human-readable reason nothing was learned */
    skipped?: string
    /** Set when the FAQ was saved but embedding/indexing failed */
    indexError?: string
}

/**
 * Deterministic PII scrubber for text learned from a conversation. Removes the visitor's name
 * and email verbatim, every other email address (the project's public support email is kept),
 * card/order-like digit runs, phone numbers and token-like strings.
 */
export function sanitizeFaqText(text: string, session: {visitorName?: string; visitorEmail?: string}, keepEmail?: string): string {
    let out = text
    for (const verbatim of [session.visitorName, session.visitorEmail]) {
        const needle = verbatim?.trim()
        if (needle) out = out.split(needle).join("the visitor")
    }
    const keep = keepEmail?.trim().toLowerCase()
    return out
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => (m.toLowerCase() === keep ? m : ""))
        .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}\b/g, "")
        .replace(/\+\d[\d ()./-]{5,}\d/g, "")
        .replace(/\b\d[\d -]{9,}\d\b/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
}

/** Parses the model's JSON reply: `{question, answer}` to learn, `{skip: reason}` to skip. */
export function parseLearnedFaq(content: string): {question?: string; answer?: string; skip?: string} | null {
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
        return JSON.parse(match[0])
    } catch {
        return null
    }
}

function buildTranscript(messages: ChatMessage[]): string {
    const lines = messages
        .filter((m) => m.content?.trim())
        .slice(-TRANSCRIPT_MESSAGES)
        .map((m) => `${m.role === "user" ? "Visitor" : m.role === "agent" ? "Support agent" : "AI assistant"}: ${m.content.trim()}`)
    let out = ""
    for (const line of lines) {
        if (out.length + line.length > TRANSCRIPT_CHARS) break
        out += `${line}\n\n`
    }
    return out.trim()
}

/**
 * Summarizes a finished conversation into a reusable FAQ entry when a human/agent contributed.
 * Creates the entry, or updates the FAQ learned from an earlier finish of the same session,
 * and (re)indexes it. Sessions without agent replies are skipped — they add no new knowledge.
 */
export async function learnFaqFromSession(project: Project, session: ChatSession): Promise<SessionLearnResult> {
    const {messages, faqs, sessions} = await useCollections()
    const list = (await messages.find({sessionId: session._id}).sort({createdAt: -1}).limit(500).toArray()).reverse()
    if (!list.some((m) => m.role === "agent")) return {skipped: "no human replies in this conversation"}
    const text = buildTranscript(list)
    if (!text) return {skipped: "the conversation is empty"}

    const res = await chatCompletion({
        model: project.model,
        temperature: 0.2,
        maxTokens: 1200,
        signal: AbortSignal.timeout(60_000),
        messages: [
            {role: "system", content: LEARN_PROMPT},
            {role: "user", content: `Conversation with a visitor of "${project.title}":\n\n${text}`}
        ]
    })
    const parsed = parseLearnedFaq(res.content)
    const question = sanitizeFaqText(parsed?.question || "", session, project.supportEmail).slice(0, 1000)
    const answer = sanitizeFaqText(parsed?.answer || "", session, project.supportEmail).slice(0, ANSWER_MAX_CHARS)
    if (!question || !answer) return {skipped: parsed?.skip || "nothing reusable for other visitors"}

    const now = new Date()
    // Re-finishing a reopened session updates its previously learned FAQ instead of duplicating it
    const existing = session.learnedFaqId ? await faqs.findOne({_id: session.learnedFaqId, projectId: project._id}) : null
    let faq: Faq
    if (existing) {
        faq = {...existing, question, answer, sessionId: session._id, updatedAt: now}
        await faqs.updateOne({_id: existing._id}, {$set: {question, answer, sessionId: session._id, updatedAt: now}})
    } else {
        faq = {_id: newId(), projectId: project._id, question, answer, sessionId: session._id, createdAt: now, updatedAt: now}
        await faqs.insertOne(faq)
    }
    if (session.learnedFaqId !== faq._id) await sessions.updateOne({_id: session._id}, {$set: {learnedFaqId: faq._id}})

    const result: SessionLearnResult = {faq}
    try {
        await indexFaq(faq)
    } catch (err: any) {
        result.indexError = String(err?.statusMessage || err?.message || err).slice(0, 300)
        logger.error("Session.learn", `Learned FAQ indexing failed for ${faq._id}`, err)
    }
    logger.info("Session.learn", `Learned FAQ ${faq._id} from session ${session._id} of ${project.title}`)
    return result
}

/**
 * Flags a conversation as finished, or reopens it (`finished: false`). Finishing triggers
 * learning via `learnFaqFromSession`; its failures never block the flag itself.
 * New messages posted into a finished session reopen it automatically ($unset in the writers).
 */
export async function finishSession(params: {session: ChatSession; finished: boolean; author: ReplyAuthor}): Promise<{session: ChatSession; learned?: SessionLearnResult}> {
    const {sessions, projects} = await useCollections()
    const {session, finished, author} = params
    if (!finished) {
        await sessions.updateOne({_id: session._id}, {$unset: {finishedAt: "", finishedBy: ""}})
        const {finishedAt, finishedBy, ...rest} = session
        return {session: rest}
    }

    const update: Pick<ChatSession, "finishedAt" | "finishedBy"> = {finishedAt: session.finishedAt ?? new Date(), finishedBy: author}
    await sessions.updateOne({_id: session._id}, {$set: update})
    const next = {...session, ...update}

    let learned: SessionLearnResult | undefined
    const project = await projects.findOne({_id: session.projectId})
    if (project && useRuntimeConfig().openrouterApiKey) {
        learned = await learnFaqFromSession(project, next).catch((err: any) => {
            logger.error("Session.learn", `Learning from session ${session._id} failed`, err)
            return {skipped: "summarization failed"}
        })
        if (learned?.faq) next.learnedFaqId = learned.faq._id
    } else {
        learned = {skipped: project ? "no OpenRouter API key configured" : "project not found"}
    }
    return {session: next, learned}
}
