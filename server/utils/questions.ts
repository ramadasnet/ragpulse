import type {AnswerEmailStatus, ChatMessage, ChatSession, Faq, Project, Question, QuestionReason} from "#shared/types"
import logger from "./logger"

export interface ReplyAuthor {
    userId?: string
    name: string
    via: "admin" | "mcp"
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
    const question: Question = {
        _id: newId(),
        projectId: project._id,
        sessionId: session._id,
        messageId: params.messageId,
        question: params.question.trim().slice(0, 4000),
        visitorName: session.visitorName,
        visitorEmail,
        reason: params.reason,
        status: "open",
        createdAt: now,
        updatedAt: now
    }
    await questions.insertOne(question)
    await sessions.updateOne({_id: session._id}, {$inc: {unansweredCount: 1}})

    if (project.supportEmail) {
        const link = publicUrl("admin", `/admin/projects/${project._id}/questions?q=${question._id}`)
        const reasonLabel = {low_confidence: "The assistant could not answer confidently", rate_limit: "The visitor reached the message limit", user_request: "The visitor asked to contact support"}[params.reason]
        const sent = await sendMail({
            to: project.supportEmail,
            replyTo: visitorEmail,
            subject: `[${project.title}] New question from ${session.visitorName}`,
            text: `${reasonLabel}.\n\nVisitor: ${session.visitorName}${visitorEmail ? ` <${visitorEmail}>` : ""}\n\nQuestion:\n${question.question}\n\nReply in RAGPulse: ${link}`,
            html: `<p>${escapeHtml(reasonLabel)}.</p>
<p><strong>Visitor:</strong> ${escapeHtml(session.visitorName)}${visitorEmail ? ` &lt;${escapeHtml(visitorEmail)}&gt;` : ""}</p>
<blockquote style="border-left:3px solid #7c5cff;margin:0;padding:8px 12px;white-space:pre-wrap">${escapeHtml(question.question)}</blockquote>
<p><a href="${escapeHtml(link)}">Reply in RAGPulse</a></p>`
        })
        if (sent) {
            question.supportNotifiedAt = new Date()
            await questions.updateOne({_id: question._id}, {$set: {supportNotifiedAt: question.supportNotifiedAt}})
        }
    }

    await sendEscalationWebhook(project, session, question)

    return question
}

/**
 * Flags a session as handled by a human when a team member replies in it while a question is open:
 * the assistant stops answering until `releaseHumanHandling` finds no open question.
 */
export async function claimHumanHandling(sessionId: string, author: ReplyAuthor): Promise<void> {
    const {sessions} = await useCollections()
    await sessions.updateOne({_id: sessionId, unansweredCount: {$gt: 0}, humanHandledAt: {$exists: false}}, {$set: {humanHandledAt: new Date(), humanHandledBy: {userId: author.userId, name: author.name}}})
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
        text: `Hi ${question.visitorName},\n\nYou asked:\n> ${question.question}\n\n${answer}\n\n— ${project.title}${project.website ? `\n${project.website}` : ""}`,
        html: `<p>Hi ${escapeHtml(question.visitorName)},</p>
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
 * project's FAQ (default, one entry per question, reusing the one learned from its finished conversation) and emails the visitor when they are not in the chat:
 * right away, or after the `answerEmailDelayMinutes` setting unless they open the chat meanwhile.
 */
export async function replyToQuestion(params: {
    questionId: string
    answer: string
    author: ReplyAuthor
    addToFaq?: boolean
    notifyVisitor?: boolean
    postToChat?: boolean
}): Promise<{question: Question; message?: ChatMessage; faq?: Faq; email: AnswerEmailStatus}> {
    const {questions, sessions, messages, projects, faqs} = await useCollections()
    const answer = params.answer.trim()
    if (!answer) throw createError({statusCode: 400, statusMessage: "Answer cannot be empty"})

    const question = await questions.findOne({_id: params.questionId})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status === "dismissed") throw createError({statusCode: 409, statusMessage: "Question was dismissed"})

    const project = await projects.findOne({_id: question.projectId})
    if (!project) throw createError({statusCode: 404, statusMessage: "Project not found"})

    const now = new Date()
    const session = await sessions.findOne({_id: question.sessionId}, {projection: {visitorSeenAt: 1, learnedFaqId: 1, endedAt: 1, endReason: 1, lastMessageAt: 1}})
    const ended = !!session && (await sessionEnded(session))
    let message: ChatMessage | undefined
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
        await sessions.updateOne({_id: question.sessionId}, {$inc: {messageCount: 1, unansweredCount: question.status === "open" ? -1 : 0}, $set: {lastMessageAt: now}, $unset: {finishedAt: "", finishedBy: ""}})
    } else if (question.status === "open") {
        await sessions.updateOne({_id: question.sessionId}, {$inc: {unansweredCount: -1}})
    }

    const update: Partial<Question> = {status: "answered", answer, answeredBy: params.author, answeredAt: now, updatedAt: now}

    const $unset: Record<string, ""> = {visitorEmailDueAt: ""}
    let email: AnswerEmailStatus = "none"
    if (params.notifyVisitor !== false && question.visitorEmail) {
        const delayMinutes = ended ? 0 : (await getAppSettings()).answerEmailDelayMinutes
        if (!ended && session?.visitorSeenAt && now.getTime() - new Date(session.visitorSeenAt).getTime() < VISITOR_PRESENT_MS) {
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
    if (params.addToFaq !== false && !question.faqId) {
        // The conversation was finished after the question was asked: its learned FAQ already covers it, so it becomes this question's entry
        const learned = session?.learnedFaqId ? await faqs.findOne({_id: session.learnedFaqId, projectId: project._id}) : null
        if (learned && new Date(learned.updatedAt) >= new Date(question.createdAt)) {
            faq = {...learned, answer, updatedAt: now}
            await faqs.updateOne({_id: learned._id}, {$set: {answer, updatedAt: now}})
            await sessions.updateOne({_id: question.sessionId}, {$unset: {learnedFaqId: ""}})
        } else {
            // The visitor's wording may hold personal data, the answer is written by the team
            const faqQuestion = sanitizeFaqText(question.question, question, project.supportEmail).slice(0, 1000) || "Visitor question"
            faq = {_id: newId(), projectId: project._id, question: faqQuestion, answer, sessionId: question.sessionId, createdAt: now, updatedAt: now}
            await faqs.insertOne(faq)
        }
        update.faqId = faq._id
        await indexFaq(faq).catch((err) => logger.error("Questions.reply", `FAQ indexing failed for ${faq!._id}`, err))
    }

    await questions.updateOne({_id: question._id}, Object.keys($unset).length ? {$set: update, $unset} : {$set: update})
    await releaseHumanHandling(question.sessionId)

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

export async function dismissQuestion(questionId: string): Promise<Question> {
    const {questions, sessions} = await useCollections()
    const question = await questions.findOne({_id: questionId})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status === "open") {
        await sessions.updateOne({_id: question.sessionId}, {$inc: {unansweredCount: -1}})
    }
    const update = {status: "dismissed" as const, updatedAt: new Date()}
    await questions.updateOne({_id: questionId}, {$set: update})
    await releaseHumanHandling(question.sessionId)
    return {...question, ...update}
}

/** Re-opens a dismissed question. */
export async function reopenQuestion(questionId: string): Promise<Question> {
    const {questions, sessions} = await useCollections()
    const question = await questions.findOne({_id: questionId})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status !== "dismissed") return question
    await sessions.updateOne({_id: question.sessionId}, {$inc: {unansweredCount: 1}})
    const update = {status: "open" as const, updatedAt: new Date()}
    await questions.updateOne({_id: questionId}, {$set: update})
    return {...question, ...update}
}

const DRAFT_PROMPT = `You write the final answer to a visitor's support question, based on a chat between the visitor and a support agent.

Rules:
- Use ONLY what the SUPPORT AGENT wrote in the chat. Do not add facts, links or promises.
- Write it directly to the visitor, as one self-contained answer: no greetings, no sign-off, no mention of the chat.
- Keep it concise, in the language of the conversation. Markdown is allowed.
- Reply with the answer text only.`

/**
 * Draft answer for an open question that a human already answered in the chat: summarizes the support
 * agent messages posted after the question. Falls back to the agent messages verbatim when no model is available.
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
    if (!(await hasAiProvider())) return {humanReplies: replies.length, draft: fallback}

    const transcript = list
        .filter((m) => m.content.trim())
        .map((m) => `${m.role === "user" ? "Visitor" : m.role === "agent" ? "Support agent" : "AI assistant"}: ${m.content.trim()}`)
        .join("\n\n")
        .slice(0, 24_000)
    try {
        const res = await chatCompletion({
            model: project.model,
            temperature: 0.2,
            maxTokens: 1200,
            signal: AbortSignal.timeout(60_000),
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
