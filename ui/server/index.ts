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
  // Stage 4 (tool policy): payment-mcp's normal, AgentRegistry-managed route
  // (Strict JWT + token exchange, same one refund-approval's own PAYMENT_URL
  // uses) -- lets this BFF call refund_payment directly, as a structured,
  // unambiguous companion to the full-chain narrative below. Needed because
  // a deny several A2A hops deep never bubbles up into support-triage's own
  // artifact list (extractToolCallSteps only sees support-triage's own
  // immediate tool calls, confirmed live -- see the '/api/stage-tool-policy/
  // ask' handler's comment).
  paymentMcpUrl: requiredEnv('PAYMENT_MCP_URL'),
  // Stage 4 (tool policy, clickops apply/remove): stage-policy-controller's own
  // internal Service DNS -- not customer-facing, only this BFF calls it. Lets a
  // presenter's "Apply policy" / "Remove policy" button control whether the
  // Deny actually exists in the cluster, instead of it being pre-provisioned
  // (and therefore also silently affecting Stage 3's own refund_payment call,
  // before a presenter ever reaches Stage 4 -- the Deny can't be scoped to
  // just this stage's demo order, since mcp.authorization can only see tool
  // identity + jwt claims, never call arguments).
  stagePolicyControllerUrl: requiredEnv('STAGE_POLICY_CONTROLLER_URL'),
  // Stage 5 (PII masking): order-db-mcp's own k8s Service, bypassing
  // agentgateway (and therefore the pii-guardrail-policy feature's
  // CheckResponse hook) entirely -- a genuinely raw baseline for comparison
  // against orderDbMcpUrl above, which real agent traffic already flows
  // through and which now has the guardrail attached.
  orderDbMcpDirectUrl: requiredEnv('ORDER_DB_MCP_DIRECT_URL'),
  // Stage 8 (telemetry): agentgateway's access-log policy (agentic-field-kit's
  // telemetry addon, already applied cluster-wide, not something this stage
  // provisions) already fans every request's structured log line into Loki --
  // this is a plain in-cluster HTTP call, not a new mechanism. Confirmed live
  // reachable from this namespace with no NetworkPolicy/mesh authorization in
  // the way.
  lokiUrl: requiredEnv('LOKI_URL'),
  // Stage 8 (telemetry): Tempo (agentic-field-kit's telemetry addon, same
  // otel-tracing-policy that's already applied cluster-wide) holds the real
  // assembled span tree per request -- confirmed live it has genuine
  // parent-child hierarchy (e.g. a tools/call span with a Guardrail child
  // span, each with their own inbound/outbound sub-spans), unlike Loki's
  // access log lines which show each hop as an isolated event with no
  // shared trace_id linking them.
  tempoUrl: requiredEnv('TEMPO_URL'),
  // Public HTTPS hostname for the "view full trace in Grafana" deep link --
  // Grafana's own Loki datasource UID is always exactly 'loki' (fixed by
  // kube-prometheus-stack's provisioning, not a random-generated UID; see
  // agentic-field-kit's telemetry addon PLUGIN_TO_UID map), so the Explore
  // URL is safely hardcoded rather than looked up.
  grafanaUrl: requiredEnv('GRAFANA_URL'),
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

app.post('/api/stage2/login', async (req, res) => {
  try {
    // If the request came in through the public OIDC gate (agentgateway's ExtAuth,
    // ahead of every request to this app), ext-auth-service already forwarded the
    // visitor's own Keycloak access token in this header -- reveal that identity
    // rather than running a second, separate ROPC login. Falls back to ROPC when the
    // header is absent (e.g. local dev via port-forward, with no gate in front).
    const forwardedToken = req.header('x-retail-returns-customer-token')
    if (forwardedToken) {
      currentCustomerToken = forwardedToken
      res.json({ claims: decodeJwtClaims(forwardedToken), viaGate: true })
      return
    }
    const token = await loginResourceOwnerPasswordCredentials({
      tokenUrl: config.keycloakTokenUrl,
      clientId: config.keycloakClientId,
      clientSecret: config.keycloakClientSecret,
      username: config.demoCustomerUsername,
      password: config.demoCustomerPassword,
    })
    currentCustomerToken = token.access_token
    res.json({ claims: decodeJwtClaims(token.access_token), viaGate: false })
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

// Stage 4 (tool policy, clickops): whether the Deny actually exists in the
// cluster is presenter-controlled, not pre-provisioned -- proxies straight
// through to stage-policy-controller's own internal API. No request/response
// transformation needed here; the controller's shape already matches what
// the UI wants ({ applied: boolean, ... }).
async function callPolicyController(path: string, method: 'GET' | 'POST'): Promise<unknown> {
  const res = await fetch(`${config.stagePolicyControllerUrl}${path}`, { method })
  const body = await res.json()
  if (!res.ok) throw new Error(typeof body === 'string' ? body : JSON.stringify(body))
  return body
}

app.post('/api/stage-tool-policy/apply-policy', async (_req, res) => {
  try {
    res.json(await callPolicyController('/stages/tool-policy/apply', 'POST'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/stage-tool-policy/remove-policy', async (_req, res) => {
  try {
    res.json(await callPolicyController('/stages/tool-policy/remove', 'POST'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/stage-tool-policy/policy-status', async (_req, res) => {
  try {
    res.json(await callPolicyController('/stages/tool-policy/status', 'GET'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// spec: down for the policy -- the live object's real spec if currently
// applied, or the exact spec applying it would create otherwise, so a
// presenter can show what the CRD actually contains before ever clicking
// "Apply policy".
app.get('/api/stage-tool-policy/policy-spec', async (_req, res) => {
  try {
    res.json(await callPolicyController('/stages/tool-policy/spec', 'GET'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 6/7 (budget, PII guardrail): read-only spec views over policies
// that are pre-provisioned by usecase deploy, not clickops-toggled here --
// same "spec: down" idea as Stage 4's viewer above, but no apply/remove
// pair, and each view can span more than one live object.
app.get('/api/stage-budget/policy-spec', async (_req, res) => {
  try {
    res.json(await callPolicyController('/policies/budget/spec', 'GET'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/stage-pii/policy-spec', async (_req, res) => {
  try {
    res.json(await callPolicyController('/policies/pii-guardrail/spec', 'GET'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// Stage 4 (tool policy): a fixed, low-value demo order (ORD-1002, $12.50, well
// under refund-approval's own $75 ask_user threshold) routed through the full
// support-triage -> order_lookup -> fraud_check -> refund_approval chain, so
// no elicitation pause happens here at all -- this stage is deliberately
// isolated from Stage 3's. refund_approval calls refund_payment directly, and
// agentgateway's identity-based mcp.authorization Deny policy (agentic-field-
// kit's stage-policy-controller feature, 'customers' in jwt.Groups) blocks it
// -- if currently applied (see the apply/remove/status endpoints above) --
// regardless of amount or what the LLM decided. No /answer companion
// endpoint is needed -- this is a single deterministic deny, not a paused
// task waiting on a human choice.
//
// The chain's own artifacts never show it, though: confirmed live (both with
// and without the Deny policy active) that extractToolCallSteps only ever
// surfaces support-triage's OWN immediate tool calls (list_orders, get_order,
// order_lookup) -- fraud_check/refund_approval/refund_payment are each a
// further A2A hop deep, made by a downstream agent's own task, and never
// bubble back up into support-triage's artifact list. So alongside the
// chain's narrative reply, this also makes payment-mcp's own refund_payment
// call directly (same identity, same route real agents use) purely to
// surface the gateway's actual structured response as unambiguous proof.
const TOOL_POLICY_DEMO_ORDER = { orderId: 'ORD-1002', amount: 12.5 }
const TOOL_POLICY_DEMO_MESSAGE =
  'Process a return for order ORD-1002: USB-C Charging Cable, purchased for $12.50 ' +
  'on 2026-07-15, delivered by FastShip (tracking FS100200), for customer CUST-100. ' +
  'Please process the full refund.'

app.post('/api/stage-tool-policy/ask', async (_req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  try {
    const result = await sendMessage(
      config.supportTriageUrl,
      TOOL_POLICY_DEMO_MESSAGE,
      currentCustomerToken,
    )
    let directCheck: { blocked: boolean; detail: string }
    try {
      const callResult = await callTool(
        config.paymentMcpUrl,
        'refund_payment',
        { order_id: TOOL_POLICY_DEMO_ORDER.orderId, amount: TOOL_POLICY_DEMO_ORDER.amount },
        currentCustomerToken,
      )
      directCheck = { blocked: false, detail: JSON.stringify(callResult) }
    } catch (err) {
      directCheck = { blocked: true, detail: err instanceof Error ? err.message : String(err) }
    }
    res.json({
      replyText: result.replyText,
      steps: extractToolCallSteps(result.raw),
      directCheck,
    })
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
// budgeted LLM response. Confirmed live: a Block-mode budget that's actually
// been exceeded attaches real, useful proof (x-ratelimit-limit/-remaining/
// -reset matching the configured cap and Day window exactly); an Audit-mode
// budget that's never been exceeded attaches nothing distinguishing at all,
// even well past its own cap -- only the same generic default headers a
// completely unbudgeted call would also carry. The UI only ever displays
// these once a call is actually blocked, for exactly that reason (see
// Stage6Budget.tsx's BudgetCard).
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
// normal-length call only spends ~40 tokens (confirmed live), well under the
// 200 cap, so one call alone never crosses it. Fires 10 SEQUENTIAL calls (not
// concurrent -- ordering matters here, unlike sub-scene 2's audit-only batch
// below), always running the full batch rather than stopping at the first
// blocked call: live-tested that agentgateway's own enforcement isn't a
// simple monotonic "blocked forever once crossed" the instant the raw token
// sum passes 200 -- a rapid sequential burst can show an occasional success
// mixed in among blocks (some kind of refill/timing behavior internal to
// agentgateway's own budget enforcement, not something this BFF has
// visibility into or controls). Firing a fixed, generously-sized batch and
// reporting the aggregate "N/10 succeeded" is robust to that -- with cumulative
// spend several times the 200 cap by the end, the vast majority of calls in
// the batch are blocked regardless of any mid-batch jitter.
//
// Sub-scene 2: demo-customer-2, budgeted Audit on USD ($1/day) -- Audit never
// blocks, so a single call can't demonstrate anything by itself. Fires a
// batch of concurrent calls with a deliberately long response per call so the
// batch's real spend approaches/crosses $1 in one click rather than requiring
// dozens of individual manual clicks. Confirmed live that Audit-mode budgets
// never attach any distinguishing header to the response (even well past $1
// of real spend, only the same generic, irrelevant default rate-limit headers
// ever appear) -- there is no client-visible proof beyond the call outcomes
// themselves, so the UI doesn't claim otherwise (see Stage6Budget.tsx).
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
      const callCount = 10
      const results: PaidCallResult[] = []
      for (let i = 0; i < callCount; i++) {
        results.push(await makePaidCall(token, false))
      }
      res.json({ customer, calls: results })
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

// Stage 8 (telemetry): a real session recap queried from Loki, not a mocked
// summary. Two separate queries because identity propagation genuinely
// differs by protocol (confirmed live against this cluster's own logs, not
// assumed): MCP-protocol log lines carry the customer's jwt_sub -- token
// exchange preserves the original subject, so filtering by it correctly
// scopes to just this customer's calls even after the Stage 2 exchange.
// LLM-protocol log lines (support-triage's own agent-to-OpenAI calls) carry
// no JWT at all -- that call uses the agent's own credential, not something
// proxied on behalf of the customer -- so those can only be scoped by the
// time window.
//
// protocol/jwt_sub/http_status/etc. are Loki structured metadata, not real
// indexed labels (confirmed live: k8s_namespace_name is the only one of
// these that's a genuine label per /loki/api/v1/labels) -- putting them
// inside the {...} stream selector silently matches zero streams. They must
// go after a pipe instead.
const SESSION_WINDOW_MINUTES = 15
const AGENTGATEWAY_NAMESPACE = 'agentgateway-proxy'

interface LokiStream {
  stream: Record<string, string>
}

async function queryLoki(logql: string, startNs: bigint, endNs: bigint): Promise<LokiStream[]> {
  const url = new URL('/loki/api/v1/query_range', config.lokiUrl)
  url.searchParams.set('query', logql)
  url.searchParams.set('limit', '500')
  url.searchParams.set('start', startNs.toString())
  url.searchParams.set('end', endNs.toString())
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Loki query failed: HTTP ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { data: { result: LokiStream[] } }
  return body.data.result
}

// Most recent N distinct trace_ids per protocol -- bounds both the number
// of Tempo lookups this endpoint fires and how many waterfalls the UI has
// to render, since a busy stage (e.g. Stage 6's 10-call budget batch) can
// easily produce more traces than are useful to show in a recap.
const MAX_TRACES_PER_PROTOCOL = 5

function recentDistinctTraceIds(streams: LokiStream[]): string[] {
  const seen = new Set<string>()
  const ordered = [...streams].sort((a, b) =>
    (b.stream.request_start_time ?? '').localeCompare(a.stream.request_start_time ?? ''),
  )
  const ids: string[] = []
  for (const s of ordered) {
    const id = s.stream.trace_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= MAX_TRACES_PER_PROTOCOL) break
  }
  return ids
}

interface TempoSpan {
  spanId: string
  parentSpanId?: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
}

interface WaterfallSpan {
  spanId: string
  name: string
  depth: number
  offsetUs: number
  durationUs: number
}

interface TraceWaterfall {
  traceId: string
  protocol: 'mcp' | 'llm'
  spans: WaterfallSpan[]
}

async function fetchTempoSpans(traceId: string): Promise<TempoSpan[] | null> {
  const res = await fetch(`${config.tempoUrl}/api/traces/${traceId}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Tempo query failed: HTTP ${res.status} ${await res.text()}`)
  const body = (await res.json()) as {
    batches?: Array<{ scopeSpans: Array<{ spans: TempoSpan[] }> }>
  }
  return (body.batches ?? []).flatMap((b) => b.scopeSpans.flatMap((ss) => ss.spans))
}

// Depth-first pre-order walk of the real parent/child span tree, each
// span's offset/duration converted to microseconds relative to the
// trace's own earliest span -- epoch nanoseconds don't fit a JS number
// safely, so all BigInt math happens here and only small relative values
// (that do fit) cross into the JSON response.
function buildWaterfall(
  traceId: string,
  protocol: 'mcp' | 'llm',
  spans: TempoSpan[],
): TraceWaterfall {
  const childrenOf = new Map<string, TempoSpan[]>()
  const byId = new Map(spans.map((s) => [s.spanId, s]))
  const roots: TempoSpan[] = []
  for (const s of spans) {
    if (s.parentSpanId && byId.has(s.parentSpanId)) {
      if (!childrenOf.has(s.parentSpanId)) childrenOf.set(s.parentSpanId, [])
      childrenOf.get(s.parentSpanId)!.push(s)
    } else {
      roots.push(s)
    }
  }
  const byStart = (a: TempoSpan, b: TempoSpan) =>
    BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1
  roots.sort(byStart)
  for (const children of childrenOf.values()) children.sort(byStart)

  const traceStart = spans
    .map((s) => BigInt(s.startTimeUnixNano))
    .reduce((min, v) => (v < min ? v : min))

  const ordered: WaterfallSpan[] = []
  const visit = (s: TempoSpan, depth: number) => {
    const start = BigInt(s.startTimeUnixNano)
    const end = BigInt(s.endTimeUnixNano)
    ordered.push({
      spanId: s.spanId,
      name: s.name,
      depth,
      offsetUs: Number((start - traceStart) / 1000n),
      durationUs: Number((end - start) / 1000n),
    })
    for (const child of childrenOf.get(s.spanId) ?? []) visit(child, depth + 1)
  }
  for (const r of roots) visit(r, 0)

  return { traceId, protocol, spans: ordered }
}

async function fetchWaterfalls(
  traceIds: string[],
  protocol: 'mcp' | 'llm',
): Promise<TraceWaterfall[]> {
  const results = await Promise.all(
    traceIds.map(async (traceId) => {
      const spans = await fetchTempoSpans(traceId)
      return spans && spans.length > 0 ? buildWaterfall(traceId, protocol, spans) : null
    }),
  )
  return results.filter((w): w is TraceWaterfall => w !== null)
}

// Grafana Explore's documented URL-state shape (schemaVersion 1, single pane)
// -- the datasource uid is the fixed 'loki' one from config.grafanaUrl's doc
// comment above, not looked up at request time.
function buildGrafanaExploreUrl(logql: string, startMs: number, endMs: number): string {
  const panes = {
    session: {
      datasource: 'loki',
      queries: [{ refId: 'A', expr: logql, datasource: { type: 'loki', uid: 'loki' } }],
      range: { from: String(startMs), to: String(endMs) },
    },
  }
  const params = new URLSearchParams({
    schemaVersion: '1',
    orgId: '1',
    panes: JSON.stringify(panes),
  })
  return `${config.grafanaUrl}/explore?${params.toString()}`
}

app.get('/api/stage8/session-summary', async (_req, res) => {
  if (!currentCustomerToken) {
    res.status(401).json({ error: 'not logged in — call /api/stage2/login first' })
    return
  }
  try {
    const claims = decodeJwtClaims(currentCustomerToken)
    const sub = String(claims.sub ?? '')
    const endMs = Date.now()
    const startMs = endMs - SESSION_WINDOW_MINUTES * 60_000
    const endNs = BigInt(endMs) * 1_000_000n
    const startNs = BigInt(startMs) * 1_000_000n

    const mcpQuery = `{k8s_namespace_name="${AGENTGATEWAY_NAMESPACE}"} | protocol="mcp" | jwt_sub="${sub}"`
    const llmQuery = `{k8s_namespace_name="${AGENTGATEWAY_NAMESPACE}"} | protocol="llm"`

    const [mcpStreams, llmStreams] = await Promise.all([
      queryLoki(mcpQuery, startNs, endNs),
      queryLoki(llmQuery, startNs, endNs),
    ])

    const mcpCalls = mcpStreams.map((s) => {
      const status = s.stream.http_status ?? ''
      return {
        backend: s.stream.backend_name || s.stream.http_path || 'unknown',
        status,
        blocked: status !== '' && status !== '200' && status !== '202',
      }
    })
    const backendsTouched = [...new Set(mcpCalls.map((c) => c.backend))].sort()
    const llmTotalTokens = llmStreams.reduce(
      (sum, s) => sum + Number(s.stream.llm_total_tokens ?? 0),
      0,
    )

    const [mcpTraces, llmTraces] = await Promise.all([
      fetchWaterfalls(recentDistinctTraceIds(mcpStreams), 'mcp'),
      fetchWaterfalls(recentDistinctTraceIds(llmStreams), 'llm'),
    ])
    const traces = [...mcpTraces, ...llmTraces]

    res.json({
      windowMinutes: SESSION_WINDOW_MINUTES,
      mcp: {
        totalCalls: mcpCalls.length,
        blockedCalls: mcpCalls.filter((c) => c.blocked).length,
        backendsTouched,
      },
      llm: {
        totalCalls: llmStreams.length,
        totalTokens: llmTotalTokens,
      },
      traces,
      tracesShown: traces.length,
      tracesTotal: mcpStreams.length + llmStreams.length,
      grafanaUrl: buildGrafanaExploreUrl(mcpQuery, startMs, endMs),
    })
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
