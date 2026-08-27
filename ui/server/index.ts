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
  supportTriageUrl: requiredEnv('SUPPORT_TRIAGE_URL'),
  // Stage 4 (elicitation) calls refund-approval directly rather than through
  // support-triage's full chain -- see the REFUND_APPROVAL_AGENT_URL comment
  // in the app manifest for why (a kagent SDK bug in nested HITL resume
  // forwarding).
  refundApprovalUrl: requiredEnv('REFUND_APPROVAL_AGENT_URL'),
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

// Stage 3 (elicitation): calls refund-approval DIRECTLY, not through
// support-triage's chain like Stage 7 does. A kagent SDK bug means nested A2A
// HITL resume forwarding (remote_a2a_tool.go's handleResume) only works
// correctly for the first hop an external client resumes -- every hop beyond
// that silently fails and falls back to a generic "pending" placeholder
// instead of the real outcome (see the "Known issues to revisit" section of
// docs/superpowers/specs/2026-08-26-retail-returns-copilot-design.md in
// agentic-field-kit). Calling refund-approval directly keeps this to exactly
// one hop, so its ask_user pause resumes reliably. The tradeoff: this message
// must carry the order/customer/amount details fraud-check would normally
// have already verified and forwarded, since refund-approval isn't reached
// through that chain here.
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
    const result = await sendMessage(config.refundApprovalUrl, message, currentCustomerToken)
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
      config.refundApprovalUrl,
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
