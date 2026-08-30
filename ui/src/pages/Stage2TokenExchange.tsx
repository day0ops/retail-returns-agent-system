import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, ChevronUp, KeyRound, LogIn, MessageCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import { SequenceDiagram, type SequenceStep } from '@/components/sequence-diagram'
import type { StageProps } from '@/pages/stage-props'

type Claims = Record<string, unknown>

const ASK_PROMPT =
  'Please call the whoami diagnostic tool on order-db and tell me exactly what it returned, including every claim.'

/**
 * Stage2TokenExchange is the guided tour's second stop: confirming the real customer
 * identity Keycloak already established (via the app's public OIDC login gate, whose
 * access token agentgateway's ExtAuth forwards to the BFF -- see
 * /api/stage2/login's viaGate path; falls back to a direct ROPC login only when
 * there's no gate in front, e.g. local dev via port-forward), then a real call to
 * support-triage carrying that token. The point of this stage is proving the RFC 8693
 * exchange actually happened -- so it shows the customer's original token claims next
 * to what order-db's `whoami` diagnostic tool says it actually received, not just a
 * description of the mechanism.
 */
export function Stage2TokenExchange({ onNext, onBack }: StageProps) {
  const [flowExpanded, setFlowExpanded] = useState(false)
  const [customerClaims, setCustomerClaims] = useState<Claims | null>(null)
  const [viaGate, setViaGate] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  const [agentReply, setAgentReply] = useState<string | null>(null)
  const [agentFailed, setAgentFailed] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  async function handleLogin() {
    setLoggingIn(true)
    setLoginError(null)
    try {
      const res = await fetch('/api/stage2/login', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setCustomerClaims(body.claims)
      setViaGate(Boolean(body.viaGate))
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleAsk() {
    setAsking(true)
    setAskError(null)
    try {
      const res = await fetch('/api/stage2/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: ASK_PROMPT }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setAgentReply(body.replyText)
      setAgentFailed(Boolean(body.failed))
    } catch (err) {
      setAskError(err instanceof Error ? err.message : String(err))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 2</p>
          <h1 className="text-2xl font-semibold">Identity & token exchange</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            The customer's token is exchanged for a scoped downstream token before it ever reaches
            order-db — agentgateway does the exchange, support-triage just forwards what it
            received.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          onClick={() => setFlowExpanded(!flowExpanded)}
          variant="ghost"
          size="sm"
          className="w-fit"
        >
          {flowExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {flowExpanded ? 'Hide request flow' : 'Show request flow'}
        </Button>
        {flowExpanded && <SequenceDiagram participants={SEQ_PARTICIPANTS} steps={SEQ_STEPS} />}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="size-4" /> 1. Confirm your identity
            </CardTitle>
            <CardDescription>
              If you came in through the public login gate, Keycloak already authenticated you there
              — this reveals that identity. Without the gate (local/dev access), it logs in directly
              instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleLogin} disabled={loggingIn} className="w-fit">
              {loggingIn ? 'Checking…' : customerClaims ? 'Refresh identity' : 'Reveal my identity'}
            </Button>
            {loginError && <p className="text-destructive text-sm">{loginError}</p>}
            {customerClaims && (
              <>
                <p className="text-muted-foreground text-xs">
                  {viaGate
                    ? 'Established by the public OIDC gate (agentgateway ExtAuth) — no password posted here.'
                    : 'Direct ROPC login (local/dev mode, no public gate in front of this request).'}
                </p>
                <ClaimsBlock label="Customer's original token" claims={customerClaims} />
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-4" /> 2. Ask support-triage
            </CardTitle>
            <CardDescription>
              support-triage forwards the customer's token to order-db; agentgateway exchanges it in
              transit.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleAsk}
              disabled={!customerClaims || asking}
              variant="secondary"
              className="w-fit"
            >
              {asking ? 'Asking…' : 'Ask support-triage to prove it'}
            </Button>
            {!customerClaims && <p className="text-muted-foreground text-sm">Log in first.</p>}
            {askError && <p className="text-destructive text-sm">{askError}</p>}
            {agentReply && (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-sm font-medium">
                  <KeyRound className="mr-1 inline size-3.5" />
                  What order-db actually received
                </p>
                <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                  {agentReply}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {customerClaims && agentReply && !agentFailed && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Badge>Exchange verified</Badge>
          <ArrowRight className="size-3.5" />
          order-db saw a different token than the one the customer logged in with.
        </p>
      )}

      <StageFooterNav onBack={onBack} onNext={onNext} nextLabel="Next: A2A handoff chain" />
    </div>
  )
}

const SEQ_PARTICIPANTS = ['Customer', 'support-triage', 'agentgateway', 'order-db']

const SEQ_STEPS: SequenceStep[] = [
  { from: 'Customer', to: 'support-triage', label: 'Request (Bearer <original token>)' },
  { from: 'support-triage', to: 'agentgateway', label: 'Forwards the request as-is' },
  { from: 'agentgateway', to: 'agentgateway', label: 'Exchanges the token (RFC 8693)', self: true },
  { from: 'agentgateway', to: 'order-db', label: 'Forwards with the EXCHANGED token' },
  { from: 'order-db', to: 'agentgateway', label: 'whoami response (real claims)' },
  { from: 'agentgateway', to: 'support-triage', label: 'Response' },
  { from: 'support-triage', to: 'Customer', label: 'Final reply' },
]

function ClaimsBlock({ label, claims }: { label: string; claims: Claims }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm font-medium">{label}</p>
      <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
        {JSON.stringify(claims, null, 2)}
      </pre>
    </div>
  )
}
