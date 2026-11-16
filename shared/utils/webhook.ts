// Escalation webhook body templates, shared by the settings UI (edit/reset) and the server (rendering).
//
// `{{placeholder}}` renders the JSON encoding of a value: strings arrive quoted, `messages` as an array.
// The quoted form "{{placeholder}}" unwraps first, so both `"q": {{question}}` and `"q": "{{question}}"` work.

/** Placeholders available in escalation webhook body templates. */
export const ESCALATION_WEBHOOK_PLACEHOLDERS = ["projectId", "projectTitle", "chatUrl", "questionUrl", "sessionId", "questionId", "reason", "visitorName", "visitorEmail", "question", "messages", "createdAt"] as const

/** Default escalation webhook body: the project, where the chat runs, the visitor, the question and the conversation. */
export const DEFAULT_ESCALATION_WEBHOOK_BODY = `{
    "event": "question.escalated",
    "project": {
        "id": {{projectId}},
        "name": {{projectTitle}}
    },
    "chatUrl": {{chatUrl}},
    "questionUrl": {{questionUrl}},
    "sessionId": {{sessionId}},
    "questionId": {{questionId}},
    "reason": {{reason}},
    "visitor": {
        "name": {{visitorName}},
        "email": {{visitorEmail}}
    },
    "question": {{question}},
    "messages": {{messages}},
    "createdAt": {{createdAt}}
}`

/** Quoted ("{{key}}") or bare ({{key}}) placeholder, matched in a single pass so substituted values are never rescanned. */
const PLACEHOLDER_RE = /"\{\{\s*([a-zA-Z]\w*)\s*\}\}"|\{\{\s*([a-zA-Z]\w*)\s*\}\}/g

/**
 * Renders a webhook body template: `{{placeholder}}` (quoted or not) is replaced by the JSON encoding
 * of the matching value, unknown placeholders stay as written. The result is raw text; callers validate
 * it parses as JSON before sending.
 */
export function renderWebhookBody(template: string, data: Record<string, unknown>): string {
    return template.replace(PLACEHOLDER_RE, (match, quotedKey?: string, bareKey?: string) => {
        const key = quotedKey ?? bareKey
        return key && Object.hasOwn(data, key) ? JSON.stringify(data[key]) : match
    })
}
