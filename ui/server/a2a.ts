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

// Low-level A2A message/send call, shared by a fresh message (sendMessage) and
// a HITL resume (resumeWithAnswer) -- both are the same JSON-RPC method, just
// with a different message shape.
async function callAgent(
  agentUrl: string,
  message: Record<string, unknown>,
  bearerToken: string,
): Promise<unknown> {
  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: { message },
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
  return json.result
}

export async function sendMessage(
  agentUrl: string,
  text: string,
  bearerToken: string,
): Promise<AskAgentResult> {
  const result = await callAgent(
    agentUrl,
    { kind: 'message', messageId: randomUUID(), role: 'user', parts: [{ kind: 'text', text }] },
    bearerToken,
  )
  return { replyText: extractReplyText(result), raw: result }
}

function partsToText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null
  const texts = parts
    .filter((p) => p && typeof p === 'object' && (p as Record<string, unknown>).kind === 'text')
    .map((p) => (p as Record<string, unknown>).text as string)
  return texts.length > 0 ? texts.join('\n') : null
}

// The result can be either a direct Message (immediate reply) or a Task
// (wraps status.message / history for longer-running interactions). Verified
// against a real multi-hop A2A chain response (Stage 3): a completed task with
// tool calls doesn't always carry status.message or an agent-role history
// entry -- the final text can live only in the last artifact's parts, mixed in
// alongside function_call/function_response data parts. Checked last since
// status.message/history are more specific when present.
export function extractReplyText(result: unknown): string {
  if (!result || typeof result !== 'object') return JSON.stringify(result)
  const obj = result as Record<string, unknown>

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

    const artifacts = obj.artifacts as Array<Record<string, unknown>> | undefined
    const lastArtifact = artifacts?.filter((a) => partsToText(a.parts)).pop()
    const artifactText = partsToText(lastArtifact?.parts)
    if (artifactText) return artifactText
  }

  return JSON.stringify(result)
}

export interface ToolCallStep {
  name: string
  args?: unknown
  result?: unknown
  error?: string
}

// Walks a completed Task's artifacts for function_call/function_response data
// parts and pairs them up by their shared A2A tool-call id, in call order.
// Each NewKAgentRemoteA2ATool hop shows up exactly like an MCP tool call does
// (Stage 2's whoami), so this same shape drives Stage 3's handoff trace.
export function extractToolCallSteps(result: unknown): ToolCallStep[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as Record<string, unknown>
  if (obj.kind !== 'task') return []

  const artifacts = (obj.artifacts as Array<Record<string, unknown>> | undefined) ?? []
  const calls = new Map<string, ToolCallStep>()
  const order: string[] = []

  for (const artifact of artifacts) {
    const parts = artifact.parts as Array<Record<string, unknown>> | undefined
    for (const part of parts ?? []) {
      if (part.kind !== 'data') continue
      const data = part.data as Record<string, unknown> | undefined
      const metadata = part.metadata as Record<string, unknown> | undefined
      if (!data || typeof data.id !== 'string' || typeof data.name !== 'string') continue

      if (metadata?.adk_type === 'function_call') {
        if (!calls.has(data.id)) order.push(data.id)
        calls.set(data.id, { ...calls.get(data.id), name: data.name, args: data.args })
      } else if (metadata?.adk_type === 'function_response') {
        const response = data.response as Record<string, unknown> | undefined
        if (!calls.has(data.id)) order.push(data.id)
        calls.set(data.id, {
          ...calls.get(data.id),
          name: data.name,
          result: response?.output ?? response?.result,
          error: typeof response?.error === 'string' ? response.error : undefined,
        })
      }
    }
  }

  return order.map((id) => calls.get(id)!).filter(Boolean)
}

export interface AskUserQuestion {
  question: string
  choices?: string[]
  multiple?: boolean
}

export interface PendingQuestion {
  taskId: string
  contextId: string
  confirmationId: string
  payload: Record<string, unknown>
  questions: AskUserQuestion[]
}

// A paused chain surfaces as the TOP-level task entering 'input-required',
// carrying an adk_request_confirmation DataPart in status.message.parts --
// confirmed live against the real 3-hop chain (order_lookup -> fraud_check ->
// refund_approval), not just kagent's hitl_test.go fixtures. Two real
// surprises versus those fixtures:
//
// 1. Metadata uses the plain ADK convention (adk_type/adk_is_long_running),
//    not kagent_type -- ReadMetadataValue in kagent's own hitl.go checks
//    adk_<key> first, kagent_<key> second, and live traffic hits the first.
//
// 2. The question text itself is NOT reachable here. Each hop's
//    RequestConfirmation (remote_a2a_tool.go:handleInputRequired) only
//    records the name of its OWN immediate next-hop tool call -- e.g.
//    support-triage's pending state names "fraud_check" (order_lookup's next
//    call), not "ask_user". HitlPartInfo has no field for further nesting,
//    so the real ask_user question -- two more hops down, inside
//    refund-approval -- genuinely isn't part of this payload; reaching it
//    would mean a separate tasks/get round-trip per intermediate agent. This
//    demo only ever asks one question (refund method), so we surface that
//    statically rather than building a multi-hop task-drilling client for it.
export function extractPendingQuestion(result: unknown): PendingQuestion | null {
  if (!result || typeof result !== 'object') return null
  const obj = result as Record<string, unknown>
  if (obj.kind !== 'task') return null

  const status = obj.status as Record<string, unknown> | undefined
  if (status?.state !== 'input-required') return null

  const statusMessage = status.message as Record<string, unknown> | undefined
  const parts = statusMessage?.parts as Array<Record<string, unknown>> | undefined
  for (const part of parts ?? []) {
    if (part.kind !== 'data') continue
    const data = part.data as Record<string, unknown> | undefined
    const metadata = part.metadata as Record<string, unknown> | undefined
    const type = metadata?.adk_type ?? metadata?.kagent_type
    const isLongRunning = metadata?.adk_is_long_running ?? metadata?.kagent_is_long_running
    if (type !== 'function_call' || isLongRunning !== true) continue
    if (data?.name !== 'adk_request_confirmation' || typeof data.id !== 'string') continue

    const args = data.args as Record<string, unknown> | undefined
    const toolConfirmation = args?.toolConfirmation as Record<string, unknown> | undefined
    const payload = (toolConfirmation?.payload as Record<string, unknown> | undefined) ?? {}

    return {
      taskId: obj.id as string,
      contextId: obj.contextId as string,
      confirmationId: data.id,
      payload,
      questions: [
        {
          question: 'How would you like your refund issued?',
          choices: ['Cash refund', 'Store credit'],
        },
      ],
    }
  }
  return null
}

export type AskAgentOutcome =
  | { kind: 'completed'; replyText: string; steps: ToolCallStep[] }
  | { kind: 'input-required'; pending: PendingQuestion }

// Resumes the paused task with the customer's answer. message.taskId/contextId
// must match the paused task exactly, or the server starts a new task instead
// of resuming this one (a2a-go's Message.TaskID/ContextID, both plain
// top-level fields, confirmed in a2a-go@v0.3.15/a2a/core.go).
//
// Wire shape confirmed against the authoritative client contract documented
// on toolconfirmation.FunctionCallName in google.golang.org/adk/v2 itself
// (tool/toolconfirmation/tool_confirmation.go): a FunctionResponse DataPart
// with the SAME id as the pending FunctionCall, name "adk_request_confirmation",
// and a response payload of { confirmed, payload } -- NOT the simplified
// { decision_type, ask_user_answers } shape (that shortcut only works for
// kagent's own internal machine-to-machine hop forwarding in
// remote_a2a_tool.go, which sends it with no function-response metadata at
// all and gets rejected by ADK's own pre-execution HandleInputRequired check
// when a raw external client sends it -- confirmed live: it fails with
// 'no input provided for function call ID ...' every time, regardless of
// decision content).
//
// One resume only unblocks the IMMEDIATE next hop, not the whole chain --
// remote_a2a_tool.go's handleInputRequired calls RequestConfirmation
// independently at every hop, so order_lookup's own resume of fraud_check
// (forwarded server-side, invisible to this client) can itself re-pause and
// bubble back up as a NEW input-required task at a new taskId. Confirmed
// live against the real 3-hop chain: resuming cascades one hop per round
// trip, not all at once. Loop, forwarding the same answer merged into each
// new pending payload, until it actually completes.
export async function resumeWithAnswer(
  agentUrl: string,
  pending: PendingQuestion,
  answers: string[][],
  bearerToken: string,
): Promise<AskAgentOutcome> {
  let current = pending
  const maxHops = 6 // generous headroom over this demo's 3-hop chain

  for (let hop = 0; hop < maxHops; hop++) {
    const message = {
      kind: 'message',
      messageId: randomUUID(),
      role: 'user',
      taskId: current.taskId,
      contextId: current.contextId,
      parts: [
        {
          kind: 'data',
          data: {
            name: 'adk_request_confirmation',
            id: current.confirmationId,
            response: {
              confirmed: true,
              payload: { ...current.payload, answers: answers.map((answer) => ({ answer })) },
            },
          },
          metadata: { adk_type: 'function_response' },
        },
      ],
    }

    const result = await callAgent(agentUrl, message, bearerToken)
    const stillPending = extractPendingQuestion(result)
    if (!stillPending) {
      return {
        kind: 'completed',
        replyText: extractReplyText(result),
        steps: extractToolCallSteps(result),
      }
    }
    current = stillPending
  }

  return { kind: 'input-required', pending: current }
}
