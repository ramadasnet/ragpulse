import type {AuthInfo} from "@modelcontextprotocol/sdk/server/auth/types.js"
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type {CallToolResult} from "@modelcontextprotocol/sdk/types.js"
import type {H3Event} from "h3"
import type {ApiToken, ProjectPermission, User} from "#shared/types"
import logger from "../logger"

// Stateless MCP endpoints never use cookies, so cross-origin MCP clients may call them directly.
export const MCP_HTTP_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate, Retry-After",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
}

/** Formats a JSON-RPC 2.0 HTTP error response for stateless MCP routes. */
export function mcpHttpError(event: H3Event, status: number, code: number, message: string, headers: Record<string, string> = {}) {
    setResponseStatus(event, status)
    setResponseHeaders(event, {"Content-Type": "application/json", ...headers})
    return {jsonrpc: "2.0", error: {code, message}, id: null}
}

/** Serves one stateless Streamable HTTP MCP request in JSON response mode. */
export async function serveMcpHttp(event: H3Event, server: McpServer, authInfo?: AuthInfo) {
    const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})
    try {
        await server.connect(transport)
        return await transport.handleRequest(toWebRequest(event), authInfo ? {authInfo} : undefined)
    } catch (err: any) {
        logger.error("MCP.request", err)
        return mcpHttpError(event, 500, -32603, "Internal server error")
    } finally {
        await transport.close().catch(() => {})
        await server.close().catch(() => {})
    }
}

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

/** JSON-safe copy (Dates -> ISO strings, undefined dropped). */
export function mcpJson<T>(value: T): any {
    return JSON.parse(JSON.stringify(value))
}

/**
 * Successful tool result: a short summary plus the JSON payload.
 * The JSON is also included in the text content because many clients only show `content` to the model.
 */
export function mcpOk(summary: string, data?: Record<string, unknown>): CallToolResult {
    if (!data) return {content: [{type: "text", text: summary}]}
    const structured = mcpJson(data) as Record<string, unknown>
    return {
        content: [{type: "text", text: `${summary}\n\n${JSON.stringify(structured, null, 2)}`}],
        structuredContent: structured
    }
}

export function mcpFail(message: string): CallToolResult {
    return {content: [{type: "text", text: `Error: ${message}`}], isError: true}
}

/** Runs a tool body and converts any thrown error into an `isError` result. Logs every call. */
export async function mcpSafely(ctx: McpContext, name: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
    const who = `${ctx.user.email}${ctx.token?.name ? ` (${ctx.token.name})` : ""}`
    try {
        const result = await fn()
        logger.info("MCP.tool", name, who, result.isError ? "error result" : "ok")
        return result
    } catch (err: any) {
        if (err instanceof McpToolError) {
            logger.info("MCP.tool", name, who, `rejected: ${err.message}`)
            return mcpFail(err.message)
        }
        const message = err?.statusMessage || err?.data?.statusMessage || err?.message || "Unexpected error"
        if (!err?.statusCode || err.statusCode >= 500) logger.error("MCP.tool", name, who, err)
        else logger.info("MCP.tool", name, who, `rejected: ${message}`)
        return mcpFail(message)
    }
}

/** Throws (-> isError result) unless the user may access the project, optionally with a permission. */
export async function mcpProject(ctx: McpContext, projectId: string, permission?: ProjectPermission) {
    if (!canAccessProject(ctx.user, projectId)) throw new McpToolError(`Project "${projectId}" not found or you have no access to it.`)
    if (permission && !hasProjectPermission(ctx.user, projectId, permission)) {
        throw new McpToolError(`Missing permission "${permission}" on project "${projectId}".`)
    }
    const {projects} = await useCollections()
    const project = await projects.findOne({_id: projectId})
    if (!project) throw new McpToolError(`Project "${projectId}" not found.`)
    return project
}

/** Project ids where the user has a permission, or `null` for all projects (admins). */
export function mcpProjectIdsWith(user: User, permission: ProjectPermission): string[] | null {
    if (user.role === "admin") return null
    return user.projects.filter((p) => p.permissions.includes(permission)).map((p) => p.projectId)
}

export function mcpTruncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function mcpEscapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Parses an ISO date argument or throws a tool error. */
export function mcpParseDate(value: string | undefined, name: string): Date | undefined {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new McpToolError(`Invalid date for "${name}": ${value}. Use ISO 8601, e.g. 2025-01-31T00:00:00Z.`)
    return date
}
