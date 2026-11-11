import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ApiToken, ProjectPermission, User } from '#shared/types'

/** Identity an MCP request acts as: the token owner (with their permissions). */
export interface McpContext {
  user: User
  token: ApiToken | null
}

/** Display name used for replies posted through MCP, e.g. `Jane (Support bot)`. */
export function mcpAuthorName(ctx: McpContext): string {
  return ctx.token?.name ? `${ctx.user.name} (${ctx.token.name})` : ctx.user.name
}

/** Error that is reported to the MCP client as an `isError` tool result. */
export class McpToolError extends Error {}

/** JSON-safe copy (Dates → ISO strings, undefined dropped). */
export function mcpJson<T>(value: T): any {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Successful tool result: a short summary plus the JSON payload.
 * The JSON is also included in the text content because many clients only show `content` to the model.
 */
export function mcpOk(summary: string, data?: Record<string, unknown>): CallToolResult {
  if (!data) return { content: [{ type: 'text', text: summary }] }
  const structured = mcpJson(data) as Record<string, unknown>
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(structured, null, 2)}` }],
    structuredContent: structured
  }
}

export function mcpFail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

/** Runs a tool body and converts any thrown error into an `isError` result. */
export async function mcpSafely(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  }
  catch (err: any) {
    if (err instanceof McpToolError) return mcpFail(err.message)
    const message = err?.statusMessage || err?.data?.statusMessage || err?.message || 'Unexpected error'
    if (!err?.statusCode || err.statusCode >= 500) console.error('[mcp] tool error:', err)
    return mcpFail(message)
  }
}

/** Throws (→ isError result) unless the user may access the project, optionally with a permission. */
export async function mcpProject(ctx: McpContext, projectId: string, permission?: ProjectPermission) {
  if (!canAccessProject(ctx.user, projectId)) throw new McpToolError(`Project "${projectId}" not found or you have no access to it.`)
  if (permission && !hasProjectPermission(ctx.user, projectId, permission)) {
    throw new McpToolError(`Missing permission "${permission}" on project "${projectId}".`)
  }
  const { projects } = await useCollections()
  const project = await projects.findOne({ _id: projectId })
  if (!project) throw new McpToolError(`Project "${projectId}" not found.`)
  return project
}

/** Project ids where the user has a permission, or `null` for all projects (admins). */
export function mcpProjectIdsWith(user: User, permission: ProjectPermission): string[] | null {
  if (user.role === 'admin') return null
  return user.projects.filter(p => p.permissions.includes(permission)).map(p => p.projectId)
}

export function mcpTruncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function mcpEscapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Parses an ISO date argument or throws a tool error. */
export function mcpParseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new McpToolError(`Invalid date for "${name}": ${value}. Use ISO 8601, e.g. 2025-01-31T00:00:00Z.`)
  return date
}
