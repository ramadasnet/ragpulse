import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { H3Event } from 'h3'
import { createRagpulseMcpServer } from '../utils/mcp/server'

// Bearer tokens (not cookies) authenticate this endpoint, so any origin may call it.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate',
  'Access-Control-Max-Age': '86400'
}

function jsonRpcError(event: H3Event, status: number, code: number, message: string, headers: Record<string, string> = {}) {
  setResponseStatus(event, status)
  setResponseHeaders(event, { 'Content-Type': 'application/json', ...headers })
  return { jsonrpc: '2.0', error: { code, message }, id: null }
}

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, CORS_HEADERS)

  if (event.method === 'OPTIONS') return sendNoContent(event, 204)

  // Stateless server: no standalone SSE stream (GET) and no sessions to terminate (DELETE)
  if (event.method !== 'POST') {
    return jsonRpcError(event, 405, -32000, 'Method not allowed. This MCP server is stateless: use POST.', { Allow: 'POST, OPTIONS' })
  }

  const header = getRequestHeader(event, 'authorization') || ''
  const bearer = header.match(/^Bearer\s+(\S+)$/i)?.[1]
  const auth = bearer ? await authenticateApiTokenRecord(bearer) : null
  if (!auth) {
    return jsonRpcError(
      event, 401, -32001,
      bearer ? 'Unauthorized: invalid or revoked API token.' : 'Unauthorized: send "Authorization: Bearer rp_…" (create a token under MCP & API in RAGPulse).',
      { 'WWW-Authenticate': `Bearer realm="ragpulse"${bearer ? ', error="invalid_token"' : ''}` }
    )
  }

  const server = createRagpulseMcpServer({ user: auth.user, token: auth.token })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  try {
    await server.connect(transport)
    return await transport.handleRequest(toWebRequest(event), {
      authInfo: {
        token: bearer!,
        clientId: auth.token._id,
        scopes: [],
        extra: { userId: auth.user._id, tokenName: auth.token.name }
      }
    })
  }
  catch (err: any) {
    console.error('[mcp] request failed:', err)
    return jsonRpcError(event, 500, -32603, 'Internal server error')
  }
  finally {
    // JSON response mode: the full response is built once handleRequest resolves
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
})
