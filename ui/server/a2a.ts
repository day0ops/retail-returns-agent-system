import { randomUUID } from 'node:crypto'

// Minimal A2A (Agent2Agent protocol) JSON-RPC client for the one call this BFF
// needs: message/send. Confirmed against the real a2a-go module (v0.3.15) this
// session rather than guessed -- the JSON-RPC handler is mounted at the
// agent's root path "/" (github.com/kagent-dev/kagent/go/adk/pkg/a2a/server),
// method name is "message/send", and Message requires messageId/role/parts
// with each part needing an explicit "kind" discriminator.

export interface AskAgentResult {
  replyText: string
  raw: unknown
}

export async function sendMessage(
  agentUrl: string,
  text: string,
  bearerToken: string,
): Promise<AskAgentResult> {
  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    },
  }

  const res = await fetch(agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`agent request failed: ${res.status} ${res.statusText} ${errText}`)
  }

  const json = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (json.error) {
    throw new Error(`agent returned a JSON-RPC error: ${json.error.message}`)
  }

  return { replyText: extractReplyText(json.result), raw: json.result }
}

// The result can be either a direct Message (immediate reply) or a Task
// (wraps status.message / history for longer-running interactions). Not
// independently verified against a live response yet -- confirm the actual
// shape once Task 6 deploys this, and tighten this extraction if it's wrong.
export function extractReplyText(result: unknown): string {
  if (!result || typeof result !== 'object') return JSON.stringify(result)
  const obj = result as Record<string, unknown>

  const partsToText = (parts: unknown): string | null => {
    if (!Array.isArray(parts)) return null
    const texts = parts
      .filter((p) => p && typeof p === 'object' && (p as Record<string, unknown>).kind === 'text')
      .map((p) => (p as Record<string, unknown>).text as string)
    return texts.length > 0 ? texts.join('\n') : null
  }

  if (obj.kind === 'message') {
    const text = partsToText(obj.parts)
    if (text) return text
  }

  if (obj.kind === 'task') {
    const status = obj.status as Record<string, unknown> | undefined
    const statusMessage = status?.message as Record<string, unknown> | undefined
    const text = partsToText(statusMessage?.parts)
    if (text) return text

    const history = obj.history as Array<Record<string, unknown>> | undefined
    const lastAgentMessage = history?.filter((m) => m.role === 'agent').pop()
    const historyText = partsToText(lastAgentMessage?.parts)
    if (historyText) return historyText
  }

  return JSON.stringify(result)
}
