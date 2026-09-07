import { randomUUID } from 'node:crypto'

// Minimal MCP (Model Context Protocol) Streamable HTTP client for the one
// thing this BFF needs: tools/list, to compare a server's real tool catalog
// before/after codeMode (Stage 4, progressive disclosure). Hand-rolled rather
// than pulling in an SDK, matching a2a.ts's precedent -- this is a 3-call
// handshake (initialize -> notifications/initialized -> tools/list), not
// enough surface to justify a dependency.

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string
  method: string
  params?: Record<string, unknown>
}

// Stage 9 (agentgateway interactive elicitation): an HTTP-level (not
// JSON-RPC) failure from the MCP endpoint itself, e.g. agentgateway's
// entTokenExchange gate returning 400 {"url": "..."} before the request ever
// reaches the MCP server. Kept as a real subclass (not string-matching the
// generic Error below) so a caller can distinguish "this call needs
// elicitation" from an ordinary MCP failure.
export class McpHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
  ) {
    super(`MCP request '${method}' failed: ${status} ${body}`)
    this.name = 'McpHttpError'
  }
}

// A Streamable HTTP MCP server may respond with plain JSON or an SSE stream
// (text/event-stream) even for a single non-push response -- the MCP spec
// permits either. Handles both rather than assuming one.
async function mcpCall(
  mcpUrl: string,
  body: JsonRpcRequest,
  sessionId: string | null,
  bearerToken?: string,
): Promise<{ result: unknown; sessionId: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`

  const res = await fetch(mcpUrl, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new McpHttpError(res.status, errText, body.method)
  }

  const newSessionId = res.headers.get('Mcp-Session-Id') ?? sessionId
  // Notifications get no meaningful body (202 Accepted, no id in the request).
  if (body.id === undefined) return { result: undefined, sessionId: newSessionId }

  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()
  if (!text) return { result: undefined, sessionId: newSessionId }

  let json: { result?: unknown; error?: { message: string } }
  if (contentType.includes('text/event-stream')) {
    const dataLine = text
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice('data:'.length)
      .trim()
    if (!dataLine) throw new Error(`MCP request '${body.method}': no data line in SSE response`)
    json = JSON.parse(dataLine)
  } else {
    json = JSON.parse(text)
  }

  if (json.error)
    throw new Error(`MCP request '${body.method}' returned an error: ${json.error.message}`)
  return { result: json.result, sessionId: newSessionId }
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

// Full initialize -> notifications/initialized -> tools/list handshake,
// returning just the tool list this BFF actually needs to display.
export async function listTools(mcpUrl: string, bearerToken?: string): Promise<McpTool[]> {
  const { sessionId } = await mcpCall(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'retail-returns-ui-bff', version: '0.1.0' },
      },
    },
    null,
    bearerToken,
  )

  await mcpCall(
    mcpUrl,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    sessionId,
    bearerToken,
  )

  const { result } = await mcpCall(
    mcpUrl,
    { jsonrpc: '2.0', id: randomUUID(), method: 'tools/list' },
    sessionId,
    bearerToken,
  )
  const tools = (result as { tools?: McpTool[] } | undefined)?.tools
  return Array.isArray(tools) ? tools : []
}

// Same initialize -> notifications/initialized handshake as listTools, but
// finishing with tools/call -- used by Stage 5 (PII masking) to fetch a real
// tool result both raw (direct to the MCP server) and masked (through
// agentgateway's pii-guardrail-policy) for a side-by-side comparison.
export async function callTool(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  bearerToken?: string,
): Promise<unknown> {
  const { sessionId } = await mcpCall(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'retail-returns-ui-bff', version: '0.1.0' },
      },
    },
    null,
    bearerToken,
  )

  await mcpCall(
    mcpUrl,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    sessionId,
    bearerToken,
  )

  const { result } = await mcpCall(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    },
    sessionId,
    bearerToken,
  )
  return result
}
