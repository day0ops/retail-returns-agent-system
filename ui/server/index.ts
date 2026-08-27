import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginResourceOwnerPasswordCredentials } from './keycloak.js'
import { decodeJwtClaims } from './jwt.js'
import { sendMessage } from './a2a.js'

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
}

// Demo-scoped simplification: a single in-memory "current customer session",
// not per-browser-session state. This is a guided tour driven by one
// presenter at a time, not a multi-user product -- if that ever changes,
// this needs real session handling (cookie + server-side session store),
// not a module-level singleton.
let currentCustomerToken: string | null = null

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
