import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginResourceOwnerPasswordCredentials } from './keycloak.js'
import { decodeJwtClaims } from './jwt.js'
import {
  sendMessage,
  extractToolCallSteps,
  extractPendingQuestion,
  resumeWithAnswer,
  type PendingQuestion,
} from './a2a.js'
import { listTools, callTool } from './mcp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const config = {
  port: process.env.PORT || '80',
  keycloakTokenUrl: requiredEnv('KEYCLOAK_TOKEN_URL'),
  keycloakClientId: requiredEnv('KEYCLOAK_CLIENT_ID'),
  keycloakClientSecret: requiredEnv('KEYCLOAK_CLIENT_SECRET'),
  demoCustomerUsername: requiredEnv('DEMO_CUSTOMER_USERNAME'),
  // Same env var name agentic-field-kit's deploy tooling uses to set this
  // password in Keycloak in the first place (addons/keycloak.js) -- must
  // hold the identical value in both places, so one shared name rather than
  // a second name that could drift out of sync.
  demoCustomerPassword: requiredEnv('RETAIL_RETURNS_CUSTOMER_PASSWORD'),
  // Stage 6 (budget control): a second real customer, same password as the
  // first -- the two sub-scenes only need distinct identities (distinct
  // jwt.email, for the customerEmail budget dimension), not distinct
  // credentials.
  demoCustomer2Username: requiredEnv('DEMO_CUSTOMER_2_USERNAME'),
  // Direct LLM endpoint the four agents already call (agentgateway's
  // OpenAI-compatible route) -- Stage 6's "make a paid call" button hits this
  // directly, carrying the chosen customer's own JWT so agentgateway can
  // resolve jwt.email for budget enforcement (see agentic-field-kit's
  // budget-policy feature; the 4 agents' own LLM calls carry no JWT at all
  // and are unaffected).
  llmBaseUrl: requiredEnv('LLM_BASE_URL'),
  supportTriageUrl: requiredEnv('SUPPORT_TRIAGE_URL'),
  // Stage 4 (progressive disclosure): before (plain, authenticated) vs.
  // after (codeMode, unauthenticated -- see the app manifest comment)
  // tool-schema comparison for order-db-mcp.
  orderDbMcpUrl: requiredEnv('ORDER_DB_MCP_URL'),
  orderDbCodemodeMcpUrl: requiredEnv('ORDER_DB_CODEMODE_MCP_URL'),
  // Stage 5 (PII masking): order-db-mcp's own k8s Service, bypassing
  // agentgateway (and therefore the pii-guardrail-policy feature's
  // CheckResponse hook) entirely -- a genuinely raw baseline for comparison
  // against orderDbMcpUrl above, which real agent traffic already flows
  // through and which now has the guardrail attached.
  orderDbMcpDirectUrl: requiredEnv('ORDER_DB_MCP_DIRECT_URL'),
}

// Demo-scoped simplification: a single in-memory "current customer session",
// not per-browser-session state. This is a guided tour driven by one
// presenter at a time, not a multi-user product -- if that ever changes,
// this needs real session handling (cookie + server-side session store),
// not a module-level singleton.
let currentCustomerToken: string | null = null

// Stage 3 (elicitation): the paused task's identity, same demo-scoped
// in-memory-singleton caveat as currentCustomerToken above -- one presenter,
// one pending question at a time.
let pendingElicitation: PendingQuestion | null = null

// Stage 6 (budget control): two customer identities need to be logged in at
// once (one budgeted Block, one Audit), unlike every other stage's single
// currentCustomerToken -- a small fixed-size map instead of a second
// singleton, same demo-scoped "one presenter" caveat otherwise.
const budgetCustomerTokens: Record<'customer1' | 'customer2', string | null> = {
  customer1: null,
  customer2: null,
}

const app = express()
app.use(express.json())

app.post('/api/stage2/login', async (_req, res) => {
  try {
    const token = await loginResourceOwnerPasswordCredentials({
      tokenUrl: config.keycloakTokenUrl,
      clientId: config.keycloakClientId,
      clientSecret: config.keycloakClientSecret,
      username: config.demoCustomerUsername,
      password: config.demoCustomerPassword,
    })
    currentCustomerToken = token.access_token
    res.json({ claims: decodeJwtClaims(token.access_token) })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/stage2/ask', async (req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  const message = typeof req.body?.message === 'string' ? req.body.message : null
  if (!message) {
    res.status(400).json({ error: 'message (string) is required' })
    return
  }
  try {
    const result = await sendMessage(config.supportTriageUrl, message, currentCustomerToken)
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 3: same login/session as Stage 2, but asks support-triage to process a
// full return -- the interesting part is the A2A handoff chain that triggers
// (order_lookup -> fraud_check -> refund_approval), not the token exchange
// itself. `steps` gives the UI each hop's tool call/response without it having
// to re-parse the raw A2A task shape.
app.post('/api/stage3/ask', async (req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  const message = typeof req.body?.message === 'string' ? req.body.message : null
  if (!message) {
    res.status(400).json({ error: 'message (string) is required' })
    return
  }
  try {
    const result = await sendMessage(config.supportTriageUrl, message, currentCustomerToken)
    res.json({ ...result, steps: extractToolCallSteps(result.raw) })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 3 (elicitation): calls support-triage, the same real entry point
// Stage 7's A2A handoff chain uses -- support-triage -> order_lookup ->
// fraud_check -> refund_approval, with refund_approval's ask_user pause
// bubbling all the way back up. This used to call refund-approval directly
// (1 hop) instead, working around a kagent SDK bug where nested A2A HITL
// resume forwarding only completed the first hop an external client resumed.
// Fixed upstream (kagent's hitl/v1 A2A Extension redesign) and confirmed live
// 2026-08-28: a single resume now completes the entire chain, so the
// workaround is no longer needed -- see the "Known issues to revisit" section
// of docs/superpowers/specs/2026-08-26-retail-returns-copilot-design.md in
// agentic-field-kit for the full investigation.
app.post('/api/stage-elicitation/ask', async (req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  const message = typeof req.body?.message === 'string' ? req.body.message : null
  if (!message) {
    res.status(400).json({ error: 'message (string) is required' })
    return
  }
  try {
    const result = await sendMessage(config.supportTriageUrl, message, currentCustomerToken)
    const pending = extractPendingQuestion(result.raw)
    if (pending) {
      pendingElicitation = pending
      res.json({ kind: 'input-required', pending })
      return
    }
    pendingElicitation = null
    res.json({
      kind: 'completed',
      replyText: result.replyText,
      steps: extractToolCallSteps(result.raw),
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/stage-elicitation/answer', async (req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  if (!pendingElicitation) {
    res.status(400).json({ error: 'no pending question — call /api/stage-elicitation/ask first' })
    return
  }
  const answer = typeof req.body?.answer === 'string' ? req.body.answer : null
  if (!answer) {
    res.status(400).json({ error: 'answer (string) is required' })
    return
  }
  try {
    const outcome = await resumeWithAnswer(
      config.supportTriageUrl,
      pendingElicitation,
      [[answer]],
      currentCustomerToken,
    )
    if (outcome.kind === 'input-required') {
      pendingElicitation = outcome.pending
      res.json(outcome)
      return
    }
    pendingElicitation = null
    res.json(outcome)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 4 (progressive disclosure): live tool-schema comparison, not
// hardcoded text. "before" is order-db's normal MCP route
// (authenticated, same one order-lookup itself calls); "after" is the
// mcp-codemode-route feature's separate Backend+HTTPRoute with
// entMcp.codeMode enabled, collapsing the same server's catalog into one
// code-execution meta-tool.
app.get('/api/stage-tool-policy/codemode-comparison', async (_req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  try {
    const [before, after] = await Promise.all([
      listTools(config.orderDbMcpUrl, currentCustomerToken),
      listTools(config.orderDbCodemodeMcpUrl),
    ])
    res.json({ before, after })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 5 (PII masking): the same get_order call, once direct to order-db-mcp's
// own Service (raw, agentgateway and its pii-guardrail-policy never see it) and
// once through the real agentgateway route real agents already use (now
// carrying the guardrail hook), for a side-by-side redacted-vs-not comparison.
app.get('/api/stage-pii/compare', async (_req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  try {
    const [raw, masked] = await Promise.all([
      callTool(config.orderDbMcpDirectUrl, 'get_order', { order_id: 'ORD-1001' }),
      callTool(config.orderDbMcpUrl, 'get_order', { order_id: 'ORD-1001' }, currentCustomerToken),
    ])
    res.json({ raw, masked })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 6 (budget control): headers worth surfacing to the UI from a real
// budgeted LLM response, if agentgateway's rate-limit-service backend adds
// them -- not yet confirmed live (checked once this feature is deployed),
// so this is a permissive substring match rather than an exact allowlist.
const BUDGET_HEADER_PATTERN = /budget|ratelimit/i

function extractBudgetHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (BUDGET_HEADER_PATTERN.test(key)) out[key] = value
  })
  return out
}

app.post('/api/stage-budget/login', async (req, res) => {
  const customer = req.body?.customer === 'customer2' ? 'customer2' : 'customer1'
  const username =
    customer === 'customer2' ? config.demoCustomer2Username : config.demoCustomerUsername
  try {
    const token = await loginResourceOwnerPasswordCredentials({
      tokenUrl: config.keycloakTokenUrl,
      clientId: config.keycloakClientId,
      clientSecret: config.keycloakClientSecret,
      username,
      password: config.demoCustomerPassword,
    })
    budgetCustomerTokens[customer] = token.access_token
    res.json({ customer, claims: decodeJwtClaims(token.access_token) })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

interface PaidCallResult {
  status: number
  ok: boolean
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  error?: string
  budgetHeaders: Record<string, string>
}

async function makePaidCall(token: string, longResponse: boolean): Promise<PaidCallResult> {
  const message = longResponse
    ? 'Write a detailed, friendly 300-word email to a customer explaining our full ' +
      'return and refund policy, including timelines, item-condition requirements, ' +
      'and how refunds are issued.'
    : 'In one sentence, summarize our return policy: refunds within 30 days of purchase.'
  const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: message }],
    }),
  })
  const budgetHeaders = extractBudgetHeaders(res.headers)
  if (!res.ok) {
    const errorBody = await res.text()
    return { status: res.status, ok: false, error: errorBody, budgetHeaders }
  }
  const body = (await res.json()) as { usage?: PaidCallResult['usage'] }
  return { status: res.status, ok: true, usage: body.usage, budgetHeaders }
}

// Sub-scene 1: demo-customer, budgeted Block on Tokens (200/day) -- a single
// normal-length call already carries enough tokens to cross it, so one click
// is enough to see it get blocked.
//
// Sub-scene 2: demo-customer-2, budgeted Audit on USD ($1/day) -- Audit never
// blocks, so a single call can't demonstrate anything by itself. Fires a
// batch of concurrent calls with a deliberately long response per call so the
// batch's real spend approaches/crosses $1 in one click rather than requiring
// dozens of individual manual clicks.
app.post('/api/stage-budget/paid-call', async (req, res) => {
  const customer = req.body?.customer === 'customer2' ? 'customer2' : 'customer1'
  const token = budgetCustomerTokens[customer]
  if (!token) {
    res
      .status(401)
      .json({ error: `not logged in as ${customer} — call /api/stage-budget/login first` })
    return
  }
  try {
    if (customer === 'customer1') {
      const result = await makePaidCall(token, false)
      res.json({ customer, calls: [result] })
      return
    }
    const batchSize = 25
    const results = await Promise.all(
      Array.from({ length: batchSize }, () => makePaidCall(token, true)),
    )
    res.json({ customer, calls: results })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Static frontend build, served after the API routes so /api/* always wins.
// Express 5's router (path-to-regexp v8) rejects a bare '*' -- needs a named
// wildcard.
app.use(express.static(path.join(__dirname, '..', 'dist')))
app.get('/*splat', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

app.listen(Number(config.port), () => {
  console.log(`retail-returns-ui BFF listening on :${config.port}`)
})
