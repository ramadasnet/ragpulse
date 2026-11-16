import {MCP_HTTP_HEADERS, mcpHttpError, serveMcpHttp} from "../utils/mcp/context"
import {createRagpulseMcpServer} from "../utils/mcp/server"

export default defineEventHandler(async (event) => {
    setResponseHeaders(event, MCP_HTTP_HEADERS)

    if (event.method === "OPTIONS") return sendNoContent(event, 204)

    // Stateless server: no standalone SSE stream (GET) and no sessions to terminate (DELETE)
    if (event.method !== "POST") {
        return mcpHttpError(event, 405, -32000, "Method not allowed. This MCP server is stateless: use POST.", {Allow: "POST, OPTIONS"})
    }

    const header = getRequestHeader(event, "authorization") || ""
    const bearer = header.match(/^Bearer\s+(\S+)$/i)?.[1]
    const auth = bearer ? await authenticateApiTokenRecord(bearer) : null
    if (!auth) {
        try {
            enforceRateLimit(event, "mcp-auth-fail", 30, 600_000)
        } catch (err: any) {
            if (err?.statusCode === 429) return mcpHttpError(event, 429, -32000, err.statusMessage || "Too many requests")
            throw err
        }
        return mcpHttpError(event, 401, -32001, bearer ? "Unauthorized: invalid, expired or revoked API token." : 'Unauthorized: send "Authorization: Bearer rp_…" (create a token under MCP & API in RAGPulse).', {
            "WWW-Authenticate": `Bearer realm="ragpulse"${bearer ? ', error="invalid_token"' : ""}`
        })
    }

    try {
        enforceRateLimit(event, "mcp-token", 300, 600_000, auth.token._id)
    } catch (err: any) {
        if (err?.statusCode === 429) return mcpHttpError(event, 429, -32000, err.statusMessage || "Too many requests")
        throw err
    }

    const server = createRagpulseMcpServer({user: auth.user, token: auth.token})
    return serveMcpHttp(event, server, {
        token: bearer!,
        clientId: auth.token._id,
        scopes: auth.token.permissions ?? [],
        extra: {userId: auth.user._id, tokenName: auth.token.name}
    })
})
