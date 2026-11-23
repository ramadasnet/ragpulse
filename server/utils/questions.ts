import type {AnswerEmailStatus, ChatMessage, ChatSession, Faq, Project, Question, QuestionReason} from "#shared/types"
import logger from "./logger"

export interface ReplyAuthor {
    userId?: string
    name: string
    via: "admin" | "mcp"
}

/** Support emails still being sent in the background, so shutdown can wait for them. */
const pendingSupportEmails = new Set<Promise<unknown>>()

/** Waits (up to `timeoutMs`) for the support emails that are still being sent, so a graceful restart does not drop them. */
export async function waitForPendingSupportEmails(timeoutMs = 10_000): Promise<void> {
    if (!pendingSupportEmails.size) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
    })
    try {
        await Promise.race([Promise.allSettled([...pendingSupportEmails]), timeout])
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Records a question the assistant could not answer and notifies the project's support email.
 * Re-uses an existing open question for the same message.
 */
export async function createQuestion(params: {project: Project; session: ChatSession; question: string; reason: QuestionReason; messageId?: string; visitorEmail?: string}): Promise<Question> {
    const {questions, sessions} = await useCollections()
    const {project, session} = params

    if (params.messageId) {
        const existing = await questions.findOne({messageId: params.messageId, status: "open"})
        if (existing) return existing
    }

    const now = new Date()
    const visitorEmail = params.visitorEmail || session.visitorEmail
    const text = params.question.trim().slice(0, 4000)
    // Classified as user specific in the background: only when an AI provider can decide
    const classify = !!text && (await hasAiProvider())
    const question: Question = {
        _id: newId(),
        projectId: project._id,
        sessionId: session._id,
        messageId: params.messageId,
        question: text,
        visitorName: session.visitorName,
        visitorEmail,
        reason: params.reason,
        status: "open",
        // Stored with the question so a reply on any server (chat or admin) sees the classification is still running
        ...(classify ? {classifyingAt: now} : {}),
        createdAt: now,
        updatedAt: now
    }
    await questions.insertOne(question)
    await sessions.updateOne({_id: session._id}, {$inc: {unansweredCount: 1}})
    logger.info("Questions.create", `Question ${question._id}`, `Project ${project._id} "${project.title}"`, `Reason ${params.reason}`, `Session ${session._id}`)

    if (project.supportEmail) {
        const link = publicUrl("admin", `/admin/projects/${project._id}/questions?q=${question._id}`)
        const reasonLabel = {low_confidence: "The assistant could not answer confidently", rate_limit: "The visitor reached the message limit", user_request: "The visitor asked to contact support"}[params.reason]
        const task: Promise<unknown> = sendMail({
            to: project.supportEmail,
            replyTo: visitorEmail,
            subject: `[${project.title}] New question from ${session.visitorName || "a visitor"}`,
            text: `${reasonLabel}.\n\nVisitor: ${session.visitorName || "(anonymous)"}${visitorEmail ? ` <${visitorEmail}>` : ""}\n\nQuestion:\n${question.question}\n\nReply in RAGPulse: ${link}`,
            html: `<p>${escapeHtml(reasonLabel)}.</p>
<p><strong>Visitor:</strong> ${escapeHtml(session.visitorName || "(anonymous)")}${visitorEmail ? ` &lt;${escapeHtml(visitorEmail)}&gt;` : ""}</p>
<blockquote style="border-left:3px solid #7c5cff;margin:0;padding:8px 12px;white-space:pre-wrap">${escapeHtml(question.question)}</blockquote>
<p><a href="${escapeHtml(link)}">Reply in RAGPulse</a></p>`
        })
            .then(async (sent) => {
                if (sent) {
                    question.supportNotifiedAt = new Date()
                    await questions.updateOne({_id: question._id}, {$set: {supportNotifiedAt: question.supportNotifiedAt}})
                }
            })
            .catch((err) => logger.error("Questions.create", `Support notification failed for ${question._id}`, err))
            .finally(() => pendingSupportEmails.delete(task))
        pendingSupportEmails.add(task)
    }

    // Fire and forget: an optional third-party POST must not delay the escalation response (it never throws)
    void sendEscalationWebhook(project, session, question)
    void notifyProject(project._id, "escalations", {
        title: `Escalated question · ${project.title}`,
        body: `${session.visitorName || "A visitor"}: ${question.question || "Asked to contact support"}`,
        url: `/admin/projects/${project._id}/questions?q=${question._id}`,
        tag: `question-${question._id}`,
        priority: true
    })
    if (classify) {
        const classification = tagUserSpecific(project, question).finally(() => pendingClassifications.delete(question._id))
        pendingClassifications.set(question._id, classification)
    }

    return question
}

/** Background user-specific classifications still running in this process, by question id: a reply waits for it before deciding on the FAQ */
const pendingClassifications = new Map<string, Promise<boolean | undefined>>()

/** Longest a classification can run: two 30 s model calls (the decision model, then the project's model) plus a margin */
const CLASSIFY_MAX_MS = 75_000
/** How often a reply on another server re-reads a question whose classification is still running */
const CLASSIFY_POLL_MS = 250

/**
 * Waits for the user-specific classification of a question that is still running, here (`pending`) or in another process
 * (the chat server classifies, the admin server replies), and returns its decision. A `classifyingAt` older than
 * `CLASSIFY_MAX_MS` is stale (e.g. the server restarted mid-classification) and is not waited for.
 */
async function awaitClassification(question: Question, pending?: Promise<boolean | undefined>): Promise<boolean | undefined> {
    if (pending) return pending
    if (!question.classifyingAt) return question.userSpecific
    const {questions} = await useCollections()
    const deadline = new Date(question.classifyingAt).getTime() + CLASSIFY_MAX_MS
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, CLASSIFY_POLL_MS))
        const fresh = await questions.findOne({_id: question._id}, {projection: {classifyingAt: 1, userSpecific: 1}})
        if (!fresh?.classifyingAt) return fresh?.userSpecific
    }
    return undefined
}

const USER_SPECIFIC_PROMPT = `You decide whether a support question escalated from a chat only concerns the one visitor who asked it, or is a general question other visitors could ask too.

- User specific: about the visitor's own account, order, subscription, billing, data or situation, so only the support team can answer it by looking at that visitor's details. Examples: "Why was my account suspended?", "Where is my order 1234?", "Why was I charged twice this month?".
- General: the answer helps other visitors too (how something works, policies, pricing, setup steps, limits), even when phrased with "I" or "my". Examples: "How do I reset my password?", "Can I run it on AWS for free?".

Reply with strict JSON only, no markdown fences: {"userSpecific": true} or {"userSpecific": false}`

/** Asks the AI whether an escalated question only concerns the visitor who asked it. Undefined when no decision could be made. */
export async function classifyUserSpecific(project: Project, question: string, questionId?: string): Promise<boolean | undefined> {
    if (!question.trim() || !(await hasAiProvider())) return undefined
    const chatModel = await projectModel(project)
    const model = (await getAppSettings()).decisionModel || chatModel
    const decide = (id: string) =>
        chatCompletion({
            model: id,
            temperature: 0,
            maxTokens: 20,
            signal: AbortSignal.timeout(30_000),
            log: {action: "Questions.classify", context: [`Question ${questionId ?? "new"}`, `Project ${project._id}`]},
            messages: [
                {role: "system", content: USER_SPECIFIC_PROMPT},
                {role: "user", content: question.slice(0, 4000)}
            ]
        })
    // The decision model may not exist on a custom provider: the project's model decides then
    const res = await decide(model).catch((err) => (model === chatModel ? Promise.reject(err) : decide(chatModel)))
    const text = res.content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
    try {
        const decision = JSON.parse(text)
        return typeof decision?.userSpecific === "boolean" ? decision.userSpecific : undefined
    } catch {
        return undefined
    }
}

/** Stores the `classifyUserSpecific` decision on a new question (clearing its `classifyingAt`) and returns it. Runs in the background and never throws. */
async function tagUserSpecific(project: Project, question: Question): Promise<boolean | undefined> {
    let userSpecific: boolean | undefined
    try {
        userSpecific = await classifyUserSpecific(project, question.question, question._id)
    } catch (err) {
        logger.warn("Questions.classify", `Could not classify question ${question._id}`, err)
    }
    try {
        const {questions} = await useCollections()
        await questions.updateOne({_id: question._id}, userSpecific === undefined ? {$unset: {classifyingAt: ""}} : {$set: {userSpecific}, $unset: {classifyingAt: ""}})
        delete question.classifyingAt
        if (userSpecific !== undefined) question.userSpecific = userSpecific
        if (userSpecific) logger.info("Questions.classify", `Question ${question._id}`, "User specific")
    } catch (err) {
        logger.warn("Questions.classify", `Could not store the classification of question ${question._id}`, err)
    }
    return userSpecific
}

/**
 * Pauses the assistant when a team member replies, without replacing an existing human handler.
 * The assistant resumes when the chat is given back to the agent or the last open question is resolved.
 */
export async function claimHumanHandling(sessionId: string, author: ReplyAuthor, options?: {requireOpenQuestion?: boolean}): Promise<void> {
    const {sessions} = await useCollections()
    await sessions.updateOne({_id: sessionId, humanHandledAt: {$exists: false}, ...(options?.requireOpenQuestion ? {unansweredCount: {$gt: 0}} : {})}, {$set: {humanHandledAt: new Date(), humanHandledBy: {userId: author.userId, name: author.name}}})
}

/** Hands the session back to the assistant once none of its questions is open. */
export async function releaseHumanHandling(sessionId: string): Promise<void> {
    const {sessions, questions} = await useCollections()
    if (await questions.countDocuments({sessionId, status: "open"}, {limit: 1})) return
    await sessions.updateOne({_id: sessionId}, {$unset: {humanHandledAt: "", humanHandledBy: ""}})
}

/** A visitor counts as in the chat when the chat reported being visible within this window (it polls every 15 s). */
const VISITOR_PRESENT_MS = 40_000
/** Presence writes are skipped when the last one is more recent than this. */
const PRESENCE_WRITE_MS = 10_000

/** Whether the visitor has the chat open right now: it reported being visible within `VISITOR_PRESENT_MS` and the conversation has not ended. */
export function visitorInChat(session: Pick<ChatSession, "visitorSeenAt" | "endedAt">, now = Date.now()): boolean {
    return !session.endedAt && !!session.visitorSeenAt && now - new Date(session.visitorSeenAt).getTime() < VISITOR_PRESENT_MS
}

/** Records that the visitor has the chat open and visible. */
export async function markVisitorSeen(sessionId: string): Promise<void> {
    const {sessions} = await useCollections()
    const now = new Date()
    await sessions.updateOne({_id: sessionId, $or: [{visitorSeenAt: {$exists: false}}, {visitorSeenAt: {$lt: new Date(now.getTime() - PRESENCE_WRITE_MS)}}]}, {$set: {visitorSeenAt: now}})
}

/** Clears the presence flag when the visitor closes the chat, so pending answers get emailed. */
export async function markVisitorAway(sessionId: string): Promise<void> {
    const {sessions} = await useCollections()
    await sessions.updateOne({_id: sessionId}, {$unset: {visitorSeenAt: ""}})
}

/** Emails the current answer of a question to the visitor. Returns true when the email was sent. */
async function sendAnswerEmail(question: Question, project: Project): Promise<boolean> {
    if (!question.visitorEmail || !question.answer) return false
    const answer = question.answer
    const chatLink = publicUrl("chat", `/chat/${project._id}`)
    return sendMail({
        to: question.visitorEmail,
        replyTo: project.supportEmail,
        subject: `Re: your question to ${project.title}`,
        text: `Hi ${question.visitorName || "there"},\n\nYou asked:\n> ${question.question}\n\n${answer}\n\n— ${project.title}${project.website ? `\n${project.website}` : ""}`,
        html: `<p>Hi ${escapeHtml(question.visitorName || "there")},</p>
<p>You asked:</p>
<blockquote style="border-left:3px solid #ccc;margin:0;padding:8px 12px;color:#555;white-space:pre-wrap">${escapeHtml(question.question)}</blockquote>
<p style="white-space:pre-wrap">${escapeHtml(answer)}</p>
<p>— ${escapeHtml(project.title)}${project.website ? `<br><a href="${escapeHtml(project.website)}">${escapeHtml(project.website)}</a>` : ""}</p>
<p style="color:#888;font-size:12px">You can also continue the conversation in the chat: <a href="${escapeHtml(chatLink)}">${escapeHtml(chatLink)}</a></p>`
    })
}

/**
 * Answers an open question: stores the answer, posts it into the chat session as an `agent` message
 * (unless `postToChat` is false, e.g. when it was already answered in the chat, or the conversation ended), adds the Q&A to the
 * project's FAQ (default unless the question is user specific, one entry per question, reusing the one learned from its finished conversation) and emails the visitor when they are not in the chat:
 * right away, or after the `answerEmailDelayMinutes` setting unless they open the chat meanwhile.
 */
export async function replyToQuestion(params: {
    questionId: string
    answer: string
    author: ReplyAuthor
    addToFaq?: boolean
    notifyVisitor?: boolean
    postToChat?: boolean
    /** Rejects replying when the question is no longer open (prevents duplicate answers from automated agents) */
    onlyOpen?: boolean
}): Promise<{question: Question; message?: ChatMessage; faq?: Faq; email: AnswerEmailStatus}> {
    const {questions, sessions, messages, projects, faqs} = await useCollections()
    const answer = params.answer.trim()
    if (!answer) throw createError({statusCode: 400, statusMessage: "Answer cannot be empty"})

    // Taken before the read: a classification finishing in between has then either been read or is still awaited below
    const pendingClassification = pendingClassifications.get(params.questionId)
    const question = await questions.findOne({_id: params.questionId})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status === "dismissed") throw createError({statusCode: 409, statusMessage: "Question was dismissed"})
    if (params.onlyOpen && question.status !== "open") {
        const by = question.answeredBy?.name ? ` by ${question.answeredBy.name}` : ""
        throw createError({statusCode: 409, statusMessage: `Question was already answered${by}`})
    }

    const project = await projects.findOne({_id: question.projectId})
    if (!project) throw createError({statusCode: 404, statusMessage: "Project not found"})

    const now = new Date()
    const update: Partial<Question> = {status: "answered", answer, answeredBy: params.author, answeredAt: now, updatedAt: now}
    // Claim the open->answered transition atomically so concurrent replies never double-decrement `unansweredCount`.
    // The answer is stored with the claim, so a question is never left "answered" without its answer.
    const claimed = question.status === "open" ? (await questions.updateOne({_id: question._id, status: "open"}, {$set: update})).modifiedCount > 0 : false
    if (params.onlyOpen && !claimed) throw createError({statusCode: 409, statusMessage: "Question was already answered or dismissed"})

    const session = await sessions.findOne({_id: question.sessionId}, {projection: {visitorSeenAt: 1, learnedFaqId: 1, endedAt: 1, endReason: 1, lastMessageAt: 1}})
    const ended = !!session && (await sessionEnded(session))
    let message: ChatMessage | undefined
    let counted = false
    // Puts a claimed question back in the open queue (and undoes the chat message) when a required write fails, so the reply can be retried
    const rollbackClaim = async () => {
        if (!claimed) return
        await questions.updateOne({_id: question._id, status: "answered", answeredAt: now}, {$set: {status: "open", updatedAt: new Date()}, $unset: {answer: "", answeredBy: "", answeredAt: ""}})
        if (message) {
            await messages.deleteOne({_id: message._id})
            await sessions.updateOne({_id: question.sessionId}, {$inc: {messageCount: -1}})
        }
        if (counted) await sessions.updateOne({_id: question.sessionId}, {$inc: {unansweredCount: 1}})
    }
    try {
        // An ended conversation gets no new messages: the answer is only recorded (and emailed)
        if (params.postToChat !== false && !ended) {
            message = {
                _id: newId(),
                projectId: question.projectId,
                sessionId: question.sessionId,
                role: "agent",
                content: answer,
                author: params.author,
                questionId: question._id,
                createdAt: now
            }
            await messages.insertOne(message)
            await sessions.updateOne({_id: question.sessionId}, {$inc: {messageCount: 1}, $set: {lastMessageAt: now}, $unset: {finishedAt: "", finishedBy: ""}})
        }
        if (claimed) {
            // No `> 0` guard: the counter can be briefly 0 while a concurrent createQuestion has inserted the question but not incremented yet
            await sessions.updateOne({_id: question.sessionId}, {$inc: {unansweredCount: -1}})
            counted = true
        }
    } catch (err) {
        await rollbackClaim().catch((rollbackErr) => logger.error("Questions.reply", `Could not roll back claim of ${question._id}`, rollbackErr))
        throw err
    }

    const $unset: Record<string, ""> = {visitorEmailDueAt: ""}
    let email: AnswerEmailStatus = "none"
    if (params.notifyVisitor !== false && question.visitorEmail) {
        const delayMinutes = ended ? 0 : (await getAppSettings()).answerEmailDelayMinutes
        if (!ended && session && visitorInChat(session, now.getTime())) {
            email = "seen"
        } else if (delayMinutes > 0) {
            update.visitorEmailDueAt = new Date(now.getTime() + delayMinutes * 60_000)
            delete $unset.visitorEmailDueAt
            email = "scheduled"
        } else if (await sendAnswerEmail({...question, answer}, project)) {
            update.visitorNotifiedAt = now
            email = "sent"
        } else {
            email = "failed"
        }
    }

    let faq: Faq | undefined
    // A reply right after the escalation waits for its classification (on this or another server), so a user-specific answer never lands in the FAQ by default
    if (params.addToFaq === undefined && question.userSpecific === undefined && !question.faqId) question.userSpecific = await awaitClassification(question, pendingClassification)
    // User-specific questions are only added when asked explicitly
    const addToFaq = params.addToFaq ?? !question.userSpecific
    // When sanitizing removes everything the answer was only personal data, so no FAQ entry is created
    const faqAnswer = addToFaq && !question.faqId ? cleanFaqText(answer, question, project.supportEmail, 8000) : ""
    if (faqAnswer) {
        try {
            // The conversation was finished after the question was asked: its learned FAQ already covers it, so it becomes this question's entry
            const learned = session?.learnedFaqId ? await faqs.findOne({_id: session.learnedFaqId, projectId: project._id}) : null
            if (learned && new Date(learned.updatedAt) >= new Date(question.createdAt)) {
                faq = {...learned, answer: faqAnswer, updatedAt: now}
                await faqs.updateOne({_id: learned._id}, {$set: {answer: faqAnswer, updatedAt: now}})
                await sessions.updateOne({_id: question.sessionId}, {$unset: {learnedFaqId: ""}})
            } else {
                // Scrub personal data from both the visitor's question and conversational greetings in the reply
                const faqQuestion = cleanFaqText(question.question, question, project.supportEmail, 1000) || "Visitor question"
                faq = {_id: newId(), projectId: project._id, question: faqQuestion, answer: faqAnswer, sessionId: question.sessionId, createdAt: now, updatedAt: now}
                await faqs.insertOne(faq)
            }
            update.faqId = faq._id
            await indexFaq(faq).catch((err) => logger.error("Questions.reply", `FAQ indexing failed for ${faq!._id}`, err))
        } catch (err) {
            // The answer is already posted: a failed FAQ write must not fail the request, or a retry would post it again
            logger.error("Questions.reply", `FAQ entry for question ${question._id} failed`, err)
            faq = undefined
            delete update.faqId
        }
    }

    // Conditional so a concurrent dismiss or reopen is never overwritten
    await questions.updateOne({_id: question._id, status: "answered"}, Object.keys($unset).length ? {$set: update, $unset} : {$set: update})
    await releaseHumanHandling(question.sessionId)
    logger.info("Questions.reply", `Question ${question._id}`, `Project ${project._id}`, `By ${params.author.name} (${params.author.via})`, `Email: ${email}${faq ? `, FAQ ${faq._id}` : ""}`)

    const {visitorEmailDueAt, ...rest} = question
    return {question: {...rest, ...update}, message, faq, email}
}

/**
 * Sends the scheduled answer emails that are due, unless the visitor opened the chat after the answer was set.
 * Each question is claimed atomically so concurrent runs never email twice.
 */
export async function sendDueAnswerEmails(limit = 50): Promise<{sent: number; skipped: number; failed: number}> {
    const {questions, sessions, projects} = await useCollections()
    const result = {sent: 0, skipped: 0, failed: 0}
    for (let i = 0; i < limit; i++) {
        const question = await questions.findOneAndUpdate({visitorEmailDueAt: {$lte: new Date()}}, {$unset: {visitorEmailDueAt: ""}}, {returnDocument: "before"})
        if (!question) break
        const [session, project] = await Promise.all([sessions.findOne({_id: question.sessionId}, {projection: {visitorSeenAt: 1}}), projects.findOne({_id: question.projectId})])
        const seen = session?.visitorSeenAt && question.answeredAt && new Date(session.visitorSeenAt) >= new Date(question.answeredAt)
        if (seen || !project || question.status !== "answered") {
            result.skipped++
            continue
        }
        if (await sendAnswerEmail(question, project)) {
            await questions.updateOne({_id: question._id}, {$set: {visitorNotifiedAt: new Date()}})
            result.sent++
        } else {
            // Restore the due marker so the next run retries instead of dropping the email for good
            await questions.updateOne({_id: question._id}, {$set: {visitorEmailDueAt: question.visitorEmailDueAt}})
            result.failed++
        }
    }
    return result
}

export async function dismissQuestion(questionId: string, actor: string): Promise<Question> {
    const {questions, sessions} = await useCollections()
    const update = {status: "dismissed" as const, updatedAt: new Date()}
    // Transition atomically from whatever the status is now, so a concurrent answer or reopen is never mishandled
    const before = await questions.findOneAndUpdate({_id: questionId, status: {$in: ["open", "answered"]}}, {$set: update}, {returnDocument: "before"})
    if (!before) {
        const existing = await questions.findOne({_id: questionId})
        if (!existing) throw createError({statusCode: 404, statusMessage: "Question not found"})
        return existing
    }
    if (before.status === "open") await sessions.updateOne({_id: before.sessionId}, {$inc: {unansweredCount: -1}})
    await releaseHumanHandling(before.sessionId)
    logger.info("Questions.dismiss", `Question ${questionId}`, `Was ${before.status}`, `By ${actor}`)
    return {...before, ...update}
}

/** Re-opens a dismissed question. */
export async function reopenQuestion(questionId: string, actor: string): Promise<Question> {
    const {questions, sessions} = await useCollections()
    const question = await questions.findOne({_id: questionId})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status !== "dismissed") return question
    const update = {status: "open" as const, updatedAt: new Date()}
    const claimed = (await questions.updateOne({_id: questionId, status: "dismissed"}, {$set: update})).modifiedCount > 0
    if (claimed) {
        await sessions.updateOne({_id: question.sessionId}, {$inc: {unansweredCount: 1}})
        logger.info("Questions.reopen", `Question ${questionId}`, `By ${actor}`)
    }
    return {...question, ...update}
}

const QUESTION_EXTRACT_PROMPT = `You write the escalation question shown in the support team's inbox for a chat between a visitor and an AI assistant.

Rules:
- Determine what the visitor actually wants answered or helped with, and write it as one short, self-contained question in the visitor's language.
- Use the visitor's own words where possible; rewrite only to make it self-contained (no "it", "that" or "this" without their referent).
- When the visitor's latest message only asks to talk to a human and no question was asked before, reply with: Wants to talk to a human.
- Reply with the question text only: no quotes, no explanation.`

/**
 * The question stored for an escalation: the triggering message may just be a handoff request
 * ("human please"), so the real question is extracted from the recent transcript with the AI.
 * Fallback: the previous visitor message for handoff requests, the message itself otherwise.
 */
export async function extractEscalatedQuestion(project: Project, history: ChatMessage[], userMessage: ChatMessage, humanRequested: boolean): Promise<string> {
    const prior = history.filter((m) => m.role === "user" && m._id !== userMessage._id && m.content.trim())
    const fallback = (humanRequested && prior.length ? prior[prior.length - 1]!.content : userMessage.content).trim().slice(0, 4000)
    const transcript = history
        .filter((m) => m.content.trim())
        .map((m) => `${m.role === "user" ? "Visitor" : m.role === "agent" ? "Support agent" : "AI assistant"}: ${m.content.trim()}`)
        .join("\n\n")
        // Keep the tail: the latest visitor message is what triggered the escalation
        .slice(-24_000)
    try {
        if (!(await hasAiProvider())) return fallback
        const res = await chatCompletion({
            model: await projectModel(project),
            temperature: 0,
            maxTokens: 200,
            signal: AbortSignal.timeout(30_000),
            log: {action: "Questions.extract", context: [`Session ${userMessage.sessionId}`, `Project ${project._id}`]},
            messages: [
                {role: "system", content: QUESTION_EXTRACT_PROMPT},
                {role: "user", content: transcript}
            ]
        })
        const text = res.content
            .trim()
            .replace(/^["'“”]+|["'“”]+$/g, "")
            .trim()
            .slice(0, 4000)
        return text || fallback
    } catch (err) {
        logger.warn("Questions.extract", `Question extraction failed for session ${userMessage.sessionId}`, err)
        return fallback
    }
}

/** Fallback notice variants: nobody took over the escalated chat in time. The details form already showed on escalation. */
function emailFallbackText(project: Project, hasEmail: boolean): string {
    if (hasEmail) return "Our team hasn't picked up the chat yet, so we'll get back to you by email soon."
    if (project.supportEmail) return "Our team hasn't picked up the chat yet. Leave your name and email below and we'll get back to you by email soon."
    return "Our team hasn't picked up the chat yet. Leave your details below so the team can get back to you."
}

/**
 * When an escalated session has waited `humanTakeoverWaitMinutes` without a human taking over, posts a
 * notice telling the visitor the answer comes by email (once per escalation, `session.emailFallbackAt`).
 * Returns whether the notice was posted.
 */
export async function maybePostEmailFallback(project: Project, session: ChatSession): Promise<boolean> {
    if (session.humanHandledAt || session.endedAt) return false
    const {questions, sessions, messages} = await useCollections()
    // Only open questions opened after the last posted notice still need one
    const filter: Record<string, unknown> = {sessionId: session._id, status: "open"}
    if (session.emailFallbackAt) filter.createdAt = {$gt: session.emailFallbackAt}
    const oldest = await questions.findOne(filter, {sort: {createdAt: 1}, projection: {createdAt: 1}})
    if (!oldest) return false
    const waitMinutes = (await getAppSettings()).humanTakeoverWaitMinutes
    if (new Date(oldest.createdAt).getTime() + waitMinutes * 60_000 > Date.now()) return false
    const now = new Date()
    // Claim before posting so concurrent polls can't double-post; only an open question newer than the last notice counts
    // A human taking over or the visitor ending the chat since the session was loaded also cancels the notice
    const claimed = await sessions.updateOne({_id: session._id, humanHandledAt: {$exists: false}, endedAt: {$exists: false}, $or: [{emailFallbackAt: {$exists: false}}, {emailFallbackAt: {$lt: oldest.createdAt}}]}, {$set: {emailFallbackAt: now}})
    if (!claimed.modifiedCount) return false
    const message: ChatMessage = {_id: newId(), projectId: project._id, sessionId: session._id, role: "assistant", content: emailFallbackText(project, !!session.visitorEmail), emailFallback: true, createdAt: now}
    try {
        await messages.insertOne(message)
    } catch (err) {
        // Release the claim so the next poll retries the notice
        await sessions.updateOne({_id: session._id, emailFallbackAt: now}, session.emailFallbackAt ? {$set: {emailFallbackAt: session.emailFallbackAt}} : {$unset: {emailFallbackAt: ""}}).catch(() => {})
        throw err
    }
    // Commit point: roll the notice back when a human took over or the chat ended since the claim
    const committed = await sessions.updateOne({_id: session._id, humanHandledAt: {$exists: false}, endedAt: {$exists: false}}, {$inc: {messageCount: 1}, $set: {lastMessageAt: now}, $unset: {finishedAt: "", finishedBy: ""}})
    if (!committed.matchedCount) {
        await messages.deleteOne({_id: message._id})
        return false
    }
    logger.info("Questions.wait", `Email fallback posted for session ${session._id}`, `Project ${project._id}`)
    return true
}

/**
 * Scheduler job: posts the email fallback notice into escalated chats nobody took over in time, so it also
 * arrives when the visitor is idle or has the chat closed (polls only post it while the chat is open).
 * Candidates: open sessions without a human, with an open question past the wait that is newer than the last notice.
 */
export async function postDueEmailFallbacks(limit = 50): Promise<number> {
    const waitMinutes = (await getAppSettings()).humanTakeoverWaitMinutes
    const {questions} = await useCollections()
    const due = await questions
        .aggregate<ChatSession>([
            {$match: {status: "open", createdAt: {$lte: new Date(Date.now() - waitMinutes * 60_000)}}},
            {$group: {_id: "$sessionId", latest: {$max: "$createdAt"}}},
            {$lookup: {from: "sessions", localField: "_id", foreignField: "_id", as: "session"}},
            {$unwind: "$session"},
            {$match: {"session.humanHandledAt": {$exists: false}, "session.endedAt": {$exists: false}, $expr: {$lt: [{$ifNull: ["$session.emailFallbackAt", new Date(0)]}, "$latest"]}}},
            {$limit: limit},
            {$replaceRoot: {newRoot: "$session"}}
        ])
        .toArray()
    let posted = 0
    for (const session of due) {
        try {
            // Chats closed for inactivity are flagged lazily: never post into them
            if (await sessionEnded(session)) continue
            const project = await getChatProject(session.projectId)
            if (project && (await maybePostEmailFallback(project, session))) posted++
        } catch (err) {
            logger.error("Questions.wait", `Email fallback failed for session ${session._id}`, err)
        }
    }
    return posted
}

const DRAFT_PROMPT = `You write the final answer to a visitor's support question, based on a chat between the visitor and a support agent.

Rules:
- Use ONLY what the SUPPORT AGENT wrote in the chat. Do not add facts, links or promises.
- Write it directly to the visitor, as one self-contained answer: no greetings, no sign-off, no mention of the chat.
- Keep it concise, in the language of the conversation. Markdown is allowed.
- Reply with the answer text only.`

/**
 * Draft answer for an open question that a human already answered in the chat: a single support agent reply
 * after the question is the answer as is, several are composed into one answer with the AI.
 * Falls back to the agent messages verbatim when no model is available.
 */
export async function draftAnswerFromChat(question: Question, project: Project): Promise<{humanReplies: number; draft: string}> {
    const {messages, questions} = await useCollections()
    const asked = question.messageId ? await messages.findOne({_id: question.messageId}, {projection: {createdAt: 1}}) : null
    const since = asked?.createdAt ?? question.createdAt
    // Agent replies after a newer question was opened target that question, not this one
    const next = await questions.findOne({sessionId: question.sessionId, _id: {$ne: question._id}, createdAt: {$gt: since}}, {sort: {createdAt: 1}, projection: {createdAt: 1}})
    const list = await messages
        .find({sessionId: question.sessionId, createdAt: next?.createdAt ? {$gte: since, $lt: next.createdAt} : {$gte: since}})
        .sort({createdAt: 1})
        .limit(100)
        .toArray()
    const replies = list.filter((m) => m.role === "agent" && !m.questionId && m.content.trim())
    if (!replies.length) return {humanReplies: 0, draft: ""}

    const fallback = replies
        .map((m) => m.content.trim())
        .join("\n\n")
        .slice(0, 8000)
    if (replies.length === 1 || !(await hasAiProvider())) return {humanReplies: replies.length, draft: fallback}

    const transcript = list
        .filter((m) => m.content.trim())
        .map((m) => `${m.role === "user" ? "Visitor" : m.role === "agent" ? "Support agent" : "AI assistant"}: ${m.content.trim()}`)
        .join("\n\n")
        .slice(0, 24_000)
    try {
        const res = await chatCompletion({
            model: await projectModel(project),
            temperature: 0.2,
            maxTokens: 1200,
            signal: AbortSignal.timeout(60_000),
            log: {action: "Questions.draft", context: [`Question ${question._id}`, `Session ${question.sessionId}`, `Project ${project._id}`, `${replies.length} replies`]},
            messages: [
                {role: "system", content: DRAFT_PROMPT},
                {role: "user", content: `Question:\n${question.question}\n\nChat:\n${transcript}`}
            ]
        })
        return {humanReplies: replies.length, draft: res.content.trim().slice(0, 8000) || fallback}
    } catch (err) {
        logger.warn("Questions.draft", `Answer draft failed for question ${question._id}`, err)
        return {humanReplies: replies.length, draft: fallback}
    }
}
