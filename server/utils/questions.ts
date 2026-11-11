import type {ChatMessage, ChatSession, Faq, Project, Question, QuestionReason} from "#shared/types"

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

    return question
}

/**
 * Answers an open question: stores the answer, posts it into the chat session as an `agent` message,
 * emails the visitor (if they left an email) and optionally adds the Q&A to the project's FAQ.
 */
export async function replyToQuestion(params: {questionId: string; answer: string; author: ReplyAuthor; addToFaq?: boolean; notifyVisitor?: boolean}): Promise<{question: Question; message: ChatMessage; faq?: Faq}> {
    const {questions, sessions, messages, projects, faqs} = await useCollections()
    const answer = params.answer.trim()
    if (!answer) throw createError({statusCode: 400, statusMessage: "Answer cannot be empty"})

    const question = await questions.findOne({_id: params.questionId})
    if (!question) throw createError({statusCode: 404, statusMessage: "Question not found"})
    if (question.status === "dismissed") throw createError({statusCode: 409, statusMessage: "Question was dismissed"})

    const project = await projects.findOne({_id: question.projectId})
    if (!project) throw createError({statusCode: 404, statusMessage: "Project not found"})

    const now = new Date()
    const message: ChatMessage = {
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
    await sessions.updateOne({_id: question.sessionId}, {$inc: {messageCount: 1, unansweredCount: question.status === "open" ? -1 : 0}, $set: {lastMessageAt: now}})

    const update: Partial<Question> = {status: "answered", answer, answeredBy: params.author, answeredAt: now, updatedAt: now}

    if (params.notifyVisitor !== false && question.visitorEmail) {
        const chatLink = publicUrl("chat", `/chat/${project._id}`)
        const sent = await sendMail({
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
        if (sent) update.visitorNotifiedAt = now
    }

    await questions.updateOne({_id: question._id}, {$set: update})

    let faq: Faq | undefined
    if (params.addToFaq) {
        faq = {_id: newId(), projectId: project._id, question: question.question, answer, createdAt: now, updatedAt: now}
        await faqs.insertOne(faq)
        await indexFaq(faq).catch((err) => console.error(`[faq] indexing failed for ${faq!._id}: ${err?.message || err}`))
    }

    return {question: {...question, ...update}, message, faq}
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
