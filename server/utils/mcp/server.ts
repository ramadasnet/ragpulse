import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { McpContext } from './context'
import { registerMcpKnowledgeTools } from './knowledge'
import { registerMcpProjectTools } from './projects'
import { registerMcpQuestionTools } from './questions'
import { registerMcpSessionTools } from './sessions'

export const MCP_SERVER_VERSION = '1.0.0'

const INSTRUCTIONS = `RAGPulse hosts AI support chats for websites and apps. Visitors ask questions; when the assistant cannot answer confidently (or the visitor asks for a human), the question is escalated as an "unanswered question".

You act with the permissions of the user who created your API token.

Typical workflow:
1. list_unanswered_questions — see open questions (with conversation context) across your projects.
2. search_knowledge / list_faqs / get_session — research the answer in the project's knowledge base and conversation.
3. reply_to_question — send the answer. It is posted into the visitor's chat and emailed to the visitor if they left an email. Set add_to_faq=true when the answer is generally useful, so the chat assistant can answer it next time.
4. dismiss_question — for spam, duplicates or questions that need no answer.

Write replies directly to the visitor, in their language, concise and friendly. Never invent facts: if the knowledge base does not contain the answer, say so instead of guessing. Other tools: list_projects, get_project, list_sessions, send_session_message, list_sources, trigger_sync, add_faq, get_project_stats.`

function triagePrompt(projectId?: string): string {
  const scope = projectId ? `project "${projectId}"` : 'all projects you can reply in'
  return `Please triage the open unanswered questions in RAGPulse for ${scope}.

1. Call list_unanswered_questions${projectId ? ` with project_id "${projectId}"` : ''} (status "open").
2. For each question:
   a. Read the question and its conversation context (call get_session if you need more).
   b. Research the answer with search_knowledge (and list_faqs) for the question's project.
   c. If the knowledge base clearly answers it, call reply_to_question with a concise, friendly answer written to the visitor in their language. Use add_to_faq=true when the answer is generally useful and not personal.
   d. If it is spam, a duplicate or needs no answer, call dismiss_question.
   e. If you cannot answer it reliably, leave it open — do not guess.
3. Finish with a short report: answered, dismissed, and left open (with the reason and what information is missing).`
}

/** Builds a fresh MCP server bound to the authenticated user (stateless: one per HTTP request). */
export function createRagpulseMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'ragpulse', title: 'RAGPulse', version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, prompts: {} } }
  )

  registerMcpProjectTools(server, ctx)
  registerMcpQuestionTools(server, ctx)
  registerMcpSessionTools(server, ctx)
  registerMcpKnowledgeTools(server, ctx)

  server.registerPrompt('answer_unanswered_questions', {
    title: 'Answer unanswered questions',
    description: 'Guides you through triaging and answering open visitor questions using the knowledge base.',
    argsSchema: { project_id: z.string().optional().describe('Limit to one project (id); omit for all projects') }
  }, ({ project_id }) => ({
    description: 'Triage open unanswered questions',
    messages: [{ role: 'user', content: { type: 'text', text: triagePrompt(project_id || undefined) } }]
  }))

  return server
}
