import { randomUUID } from 'node:crypto'

// Minimal A2A (Agent2Agent protocol) JSON-RPC client for the one call this BFF
// needs: SendMessage. Confirmed against the real a2a-go v2 module this session
// (kagent's HITL v1 extension upgrade pulled it in) rather than guessed -- the
// JSON-RPC handler is mounted at the agent's root path "/"
// (github.com/kagent-dev/kagent/go/adk/pkg/a2a/server), the RPC method name is
// "SendMessage" (PascalCase, not the old "message/send"), the result is a
// oneof wrapper ({ task: {...} } or { message: {...} }, not a flat object with
// its own "kind" field), and Part objects no longer carry an explicit "kind"
// discriminator -- text vs. data parts are told apart by which of "text"/
// "data" is present.
//
// HITL (Stage 3's elicitation pause/resume) uses kagent's hitl/v1 A2A
// Extension (see docs.md's human-in-the-loop.md at the pinned kagent commit)
// instead of the old private adk_request_confirmation DataPart convention --
// the old convention didn't round-trip correctly through more than one A2A
// hop, which is exactly the "kagent SDK bug" the design doc's "Known issues"
// section used to document as a permanent limitation. Fixed upstream; this
// client was rewritten to match, not just patched to compile.
const HITL_EXTENSION_URI = 'https://kagent.dev/extensions/hitl/v1'

export interface AskAgentResult {
  replyText: string
  raw: unknown
}

// Tags the oneof wrapper's contents with a `kind` so the rest of this file's
// extraction helpers can keep branching on `obj.kind` like before, without
// needing every call site to know about the wrapper shape.
type TaggedResult =
  ({ kind: 'task' } & Record<string, unknown>) | ({ kind: 'message' } & Record<string, unknown>)

function tagResult(result: unknown): TaggedResult {
  const obj = result as Record<string, unknown>
  if (obj?.task && typeof obj.task === 'object') return { kind: 'task', ...(obj.task as object) }
  if (obj?.message && typeof obj.message === 'object')
    return { kind: 'message', ...(obj.message as object) }
  return result as TaggedResult
}

// Low-level A2A SendMessage call, shared by a fresh message (sendMessage) and
// a HITL resume (resumeWithAnswer) -- both are the same JSON-RPC method, just
// with a different message shape. callers get an A2A-Extensions header on
// every call so the server always activates hitl/v1 for this client.
async function callAgent(
  agentUrl: string,
  message: Record<string, unknown>,
  bearerToken: string,
): Promise<TaggedResult> {
  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'SendMessage',
    params: { message },
  }

  const res = await fetch(agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
      'A2A-Extensions': HITL_EXTENSION_URI,
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
  return tagResult(json.result)
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

// Inbound parts no longer carry an explicit "kind" discriminator (a2a-go v2)
// -- a text part is just { text: "..." }, told apart from a data part by
// which field is present, not by a tag.
function partsToText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null
  const texts = parts
    .filter(
      (p) => p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string',
    )
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
    const lastAgentMessage = history?.filter((m) => m.role === 'ROLE_AGENT').pop()
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
  // The opaque hitl/v1 id to echo back in the ask_user_response -- the
  // top-level request's own `id` for a direct pause, or `nested.tools[0].id`
  // for a pause bubbled up through a remote-agent hop (the parent resumes
  // using the CHILD's id, not its own; kagent's executor resolves which of
  // its own pending calls that maps to).
  resumeId: string
  questions: AskUserQuestion[]
}

// A paused task surfaces as TASK_STATE_INPUT_REQUIRED, carrying kagent's
// hitl/v1 A2A Extension payload on status.message (see
// docs/architecture/human-in-the-loop.md at the pinned kagent commit) --
// confirmed live against the real 4-hop chain, not just read from docs.
// Replaces the old private adk_request_confirmation DataPart convention,
// which never round-tripped correctly through more than one A2A hop (the
// "kagent SDK bug" the design doc's "Known issues" section used to document
// as a permanent limitation -- fixed upstream, confirmed live 2026-08-28).
//
// A nested pause (support-triage waiting on order_lookup waiting on
// fraud_check waiting on refund_approval's real ask_user call) still exposes
// the real, dynamic question text at `payload.questions` regardless of
// nesting depth -- "has the same questions field as a direct request" per
// the extension doc -- so no placeholder fallback is needed here anymore.
export function extractPendingQuestion(result: unknown): PendingQuestion | null {
  if (!result || typeof result !== 'object') return null
  const obj = result as Record<string, unknown>
  if (obj.kind !== 'task') return null

  const status = obj.status as Record<string, unknown> | undefined
  if (status?.state !== 'TASK_STATE_INPUT_REQUIRED') return null

  const statusMessage = status.message as Record<string, unknown> | undefined
  const extensions = statusMessage?.extensions as string[] | undefined
  if (!Array.isArray(extensions) || !extensions.includes(HITL_EXTENSION_URI)) return null

  const metadata = statusMessage?.metadata as Record<string, unknown> | undefined
  const payload = metadata?.[HITL_EXTENSION_URI] as Record<string, unknown> | undefined
  if (!payload || payload.type !== 'ask_user_request') return null

  const nested = payload.nested as Record<string, unknown> | undefined
  const nestedTools = nested?.tools as Array<Record<string, unknown>> | undefined
  const resumeId = (nested ? nestedTools?.[0]?.id : payload.id) as string | undefined
  if (!resumeId) return null

  const questions = payload.questions as AskUserQuestion[] | undefined

  return {
    taskId: obj.id as string,
    contextId: obj.contextId as string,
    resumeId,
    questions:
      Array.isArray(questions) && questions.length > 0
        ? questions
        : [
            {
              question: 'How would you like your refund issued?',
              choices: ['Cash refund', 'Store credit'],
            },
          ],
  }
}

export type AskAgentOutcome =
  | { kind: 'completed'; replyText: string; steps: ToolCallStep[] }
  | { kind: 'input-required'; pending: PendingQuestion }

// Resumes the paused task with the customer's answer. message.taskId/contextId
// must match the paused task exactly, or the server starts a new task instead
// of resuming this one.
//
// A single resume now resolves the ENTIRE chain server-side -- confirmed live
// against the real 4-hop chain (support-triage -> order_lookup -> fraud_check
// -> refund_approval): kagent's executor forwards the hitl/v1 response to the
// saved child task/context itself, recursively, rather than requiring the
// client to keep resuming a newly-bubbled-up pause once per hop the way the
// old adk_request_confirmation convention did. The hop loop below is kept as
// defensive headroom (a still-pending result just means "resume again"), not
// because it's expected to iterate more than once in practice anymore.
export async function resumeWithAnswer(
  agentUrl: string,
  pending: PendingQuestion,
  answers: string[][],
  bearerToken: string,
): Promise<AskAgentOutcome> {
  let current = pending
  const maxHops = 6 // defensive headroom; a single resume resolves the whole chain in practice

  for (let hop = 0; hop < maxHops; hop++) {
    const message = {
      kind: 'message',
      messageId: randomUUID(),
      role: 'user',
      taskId: current.taskId,
      contextId: current.contextId,
      extensions: [HITL_EXTENSION_URI],
      metadata: {
        [HITL_EXTENSION_URI]: {
          type: 'ask_user_response',
          id: current.resumeId,
          answers: answers.map((answer) => ({ answer })),
        },
      },
      parts: [{ kind: 'text', text: 'Human input supplied' }],
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
