import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, ChevronUp, KeyRound, LogIn, MessageCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import type { StageProps } from '@/pages/stage-props'

type Claims = Record<string, unknown>

const ASK_PROMPT =
  'Please call the whoami diagnostic tool on order-db and tell me exactly what it returned, including every claim.'

/**
 * Stage2TokenExchange is the guided tour's second stop: a real customer login
 * (Resource Owner Password Credentials against Keycloak, via the BFF), then a
 * real call to support-triage carrying that token. The point of this stage is
 * proving the RFC 8693 exchange actually happened -- so it shows the
 * customer's original token claims next to what order-db's `whoami`
 * diagnostic tool says it actually received, not just a description of the
 * mechanism.
 */
export function Stage2TokenExchange({ onNext, onBack }: StageProps) {
  const [flowExpanded, setFlowExpanded] = useState(false)
  const [customerClaims, setCustomerClaims] = useState<Claims | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  const [agentReply, setAgentReply] = useState<string | null>(null)
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
        {flowExpanded && <SequenceDiagram />}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="size-4" /> 1. Log in as the demo customer
            </CardTitle>
            <CardDescription>
              A real Resource Owner Password Credentials login against Keycloak's
              retail-returns-customers realm.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleLogin} disabled={loggingIn} className="w-fit">
              {loggingIn ? 'Logging in…' : customerClaims ? 'Log in again' : 'Log in as customer'}
            </Button>
            {loginError && <p className="text-destructive text-sm">{loginError}</p>}
            {customerClaims && (
              <ClaimsBlock label="Customer's original token" claims={customerClaims} />
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

      {customerClaims && agentReply && (
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

interface SeqStep {
  from: string
  to: string
  label: string
  self?: boolean
}

const SEQ_PARTICIPANTS = ['Customer', 'support-triage', 'agentgateway', 'order-db']

const SEQ_STEPS: SeqStep[] = [
  { from: 'Customer', to: 'support-triage', label: 'Request (Bearer <original token>)' },
  { from: 'support-triage', to: 'agentgateway', label: 'Forwards the request as-is' },
  { from: 'agentgateway', to: 'agentgateway', label: 'Exchanges the token (RFC 8693)', self: true },
  { from: 'agentgateway', to: 'order-db', label: 'Forwards with the EXCHANGED token' },
  { from: 'order-db', to: 'agentgateway', label: 'whoami response (real claims)' },
  { from: 'agentgateway', to: 'support-triage', label: 'Response' },
  { from: 'support-triage', to: 'Customer', label: 'Final reply' },
]

// A from-scratch animated sequence diagram (not a diagramming library --
// this is the only place in the tour that needs one so far): vertical
// lifelines, one per participant, with each step's arrow fading in in
// order down the page so the actual temporal flow of one request reads
// clearly, not just a static "who talks to whom".
function SequenceDiagram() {
  const width = 640
  const rowHeight = 42
  const topPad = 36
  const height = topPad + SEQ_STEPS.length * rowHeight + 16
  const colX = (name: string) => {
    const i = SEQ_PARTICIPANTS.indexOf(name)
    return SEQ_PARTICIPANTS.length === 1
      ? width / 2
      : 48 + (i / (SEQ_PARTICIPANTS.length - 1)) * (width - 96)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="border-border bg-card w-full overflow-x-auto rounded-xl border p-4"
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[560px]" role="img">
        <defs>
          <marker id="seq-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent-foreground)" />
          </marker>
        </defs>
        {SEQ_PARTICIPANTS.map((p) => (
          <g key={p}>
            <text
              x={colX(p)}
              y={16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {p}
            </text>
            <line
              x1={colX(p)}
              y1={24}
              x2={colX(p)}
              y2={height - 8}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
          </g>
        ))}
        {SEQ_STEPS.map((step, i) => {
          const y = topPad + i * rowHeight
          if (step.self) {
            const x = colX(step.from)
            return (
              <motion.g
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.35, duration: 0.3 }}
              >
                <text x={x + 14} y={y - 4} fontSize={10} fill="var(--muted-foreground)">
                  {step.label}
                </text>
                <path
                  d={`M ${x} ${y - 8} q 24 8 0 16`}
                  fill="none"
                  stroke="var(--accent-foreground)"
                  strokeWidth={1.5}
                  markerEnd="url(#seq-arrow)"
                />
              </motion.g>
            )
          }
          const x1 = colX(step.from)
          const x2 = colX(step.to)
          return (
            <motion.g
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.35, duration: 0.3 }}
            >
              <text
                x={(x1 + x2) / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {step.label}
              </text>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="var(--accent-foreground)"
                strokeWidth={1.5}
                markerEnd="url(#seq-arrow)"
              />
            </motion.g>
          )
        })}
      </svg>
    </motion.div>
  )
}

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
