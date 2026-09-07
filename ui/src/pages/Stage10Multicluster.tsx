import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, ChevronUp, Globe2, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import { SequenceDiagram, type SequenceStep } from '@/components/sequence-diagram'
import type { StageProps } from '@/pages/stage-props'

const DEMO_ORDER_ID = 'ORD-1002'

interface LoyaltyAccount {
  customer_id: string
  points: number
  tier: string
}

interface ToolCallStep {
  name: string
  args?: unknown
  result?: unknown
  error?: string
}

function extractAccount(result: unknown): LoyaltyAccount | null {
  const obj = result as { structuredContent?: { account?: LoyaltyAccount } } | undefined
  return obj?.structuredContent?.account ?? null
}

/**
 * Stage10Multicluster is the guided tour's tenth and final stop:
 * loyalty-rewards-mcp runs entirely on the west cluster, cataloged into
 * east's AgentRegistry via a cross-cluster mesh.internal URL -- not a
 * separate mechanism grafted on for the demo, refund-approval calls it as a
 * real step in finishing any return (a goodwill points bonus), the same way
 * it already calls payment-mcp. The cross-cluster hop is invisible to the
 * agent; what makes it provable here is a real points balance that only
 * changes if the west-cluster round trip actually happened. See
 * agentic-field-kit's Phase 10 plan doc for the full mechanism.
 */
export function Stage10Multicluster({ onBack }: StageProps) {
  const [flowExpanded, setFlowExpanded] = useState(false)
  const [balanceBefore, setBalanceBefore] = useState<LoyaltyAccount | null>(null)
  const [balanceAfter, setBalanceAfter] = useState<LoyaltyAccount | null>(null)
  const [replyText, setReplyText] = useState<string | null>(null)
  const [steps, setSteps] = useState<ToolCallStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)

  async function handleCheckBalance() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage10/balance')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setBalanceBefore(extractAccount(body.result))
      setBalanceAfter(null)
      setChecked(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleProcessReturn() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage10/process-return', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setBalanceBefore(extractAccount(body.balanceBefore))
      setBalanceAfter(extractAccount(body.balanceAfter))
      setReplyText(body.replyText)
      setSteps(body.steps ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pointsAwarded =
    balanceBefore && balanceAfter ? balanceAfter.points - balanceBefore.points : null

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 10</p>
          <h1 className="text-2xl font-semibold">Multicluster: loyalty rewards</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            loyalty-rewards-mcp runs entirely on a separate physical cluster (west), cataloged into
            east's AgentRegistry the same way as every other server — refund-approval calls it
            transparently as part of finishing this return.
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
              <Globe2 className="size-4" /> 1. Check the current loyalty balance
            </CardTitle>
            <CardDescription>
              A direct call to loyalty-rewards-mcp on the west cluster, before anything runs — the
              "before" snapshot for the proof below.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleCheckBalance}
              disabled={busy}
              variant="secondary"
              className="w-fit"
            >
              {busy && !checked ? 'Checking…' : 'Check balance'}
            </Button>
            {balanceBefore && (
              <p className="text-muted-foreground text-sm">
                {balanceBefore.customer_id}:{' '}
                <span className="font-medium">{balanceBefore.points}</span> points (
                {balanceBefore.tier})
              </p>
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
              <Sparkles className="size-4" /> 2. Process a return for {DEMO_ORDER_ID}
            </CardTitle>
            <CardDescription>
              The real support-triage → order_lookup → fraud_check → refund_approval chain.
              refund-approval settles the refund, then awards a goodwill points bonus via
              loyalty-rewards-mcp — a real cross-cluster MCP call inside the real agent chain.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleProcessReturn} disabled={busy} className="w-fit">
              {busy ? 'Processing…' : 'Process return'}
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
            {replyText && <p className="text-sm">{replyText}</p>}
            {steps.length > 0 && (
              <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify(steps, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {balanceBefore && balanceAfter && pointsAwarded !== null && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Badge>{pointsAwarded > 0 ? 'Awarded on the west cluster' : 'No change'}</Badge>
          <ArrowRight className="size-3.5" />
          {balanceBefore.points} → {balanceAfter.points} points
          {pointsAwarded > 0 ? ` (+${pointsAwarded})` : ''}
        </p>
      )}

      <StageFooterNav onBack={onBack} />
    </div>
  )
}

const SEQ_PARTICIPANTS = [
  'Customer',
  'support-triage',
  'refund-approval',
  'agentgateway (east)',
  'loyalty-rewards-mcp (west)',
]

const SEQ_STEPS: SequenceStep[] = [
  { from: 'Customer', to: 'support-triage', label: `"Process a return for ${DEMO_ORDER_ID}"` },
  {
    from: 'support-triage',
    to: 'refund-approval',
    label: 'A2A chain (order_lookup → fraud_check → refund_approval)',
  },
  { from: 'refund-approval', to: 'agentgateway (east)', label: 'refund_payment(...)' },
  {
    from: 'refund-approval',
    to: 'agentgateway (east)',
    label: 'award_points(customer_id, points)',
  },
  {
    from: 'agentgateway (east)',
    to: 'agentgateway (east)',
    label: 'AgentRegistry route → spoke-agentgateway-proxy.mesh.internal',
    self: true,
  },
  {
    from: 'agentgateway (east)',
    to: 'loyalty-rewards-mcp (west)',
    label: 'HBONE/mTLS, cross-cluster',
  },
  { from: 'loyalty-rewards-mcp (west)', to: 'Customer', label: 'Real updated balance' },
]
