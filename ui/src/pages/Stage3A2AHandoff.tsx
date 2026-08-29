import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, PackageSearch, ShieldAlert, Wallet, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import type { StageProps } from '@/pages/stage-props'

interface ToolCallStep {
  name: string
  args?: unknown
  result?: unknown
  error?: string
}

interface AskResponse {
  replyText: string
  steps: ToolCallStep[]
}

// ORD-1006 ($45.00), not ORD-1001 -- deliberately under refund-approval's own
// $75 ask_user threshold. This stage's endpoint (/api/stage3/ask) has no
// pause/resume handling, since elicitation is Stage 4's own dedicated demo;
// ORD-1001 crosses that threshold and used to leave this stage showing a raw
// "Remote agent 'order_lookup' requires approval for tool(s): ask_user" error
// most of the time instead of a clean handoff trace (confirmed live: ORD-1001
// paused on ~87% of runs). See Stage 4 for the elicitation pause itself.
const ASK_PROMPT = 'I want to return order ORD-1006 for a refund. Please process the full return.'

// Maps a tool call's name to how this stage presents it -- get_order is
// support-triage's own MCP call (not an A2A hop), the rest are the
// NewKAgentRemoteA2ATool hops that make up the actual handoff chain.
const STEP_PRESENTATION: Record<string, { label: string; icon: typeof PackageSearch }> = {
  get_order: { label: 'support-triage looked up the order', icon: PackageSearch },
  order_lookup: { label: 'support-triage → order-lookup (A2A)', icon: PackageSearch },
  fraud_check: { label: 'order-lookup → fraud-check (A2A)', icon: ShieldAlert },
  refund_approval: { label: 'fraud-check → refund-approval (A2A)', icon: Wallet },
}

/**
 * Stage3A2AHandoff is the guided tour's third stop: a real multi-agent
 * handoff chain triggered by a single customer request. support-triage looks
 * up the order, then delegates to order-lookup via a real A2A message/send
 * call, which delegates to fraud-check, which delegates to refund-approval --
 * each hop routed through agentgateway and carrying the customer's identity
 * token (exchanged at every hop, same mechanism as Stage 2). Reuses Stage 2's
 * login session; this stage doesn't ask the customer to log in again.
 */
export function Stage3A2AHandoff({ onNext }: StageProps) {
  const [response, setResponse] = useState<AskResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  async function handleAsk() {
    setAsking(true)
    setError(null)
    try {
      const res = await fetch('/api/stage3/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: ASK_PROMPT }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setResponse(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 3</p>
          <h1 className="text-2xl font-semibold">A2A handoff chain</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            One customer request triggers a real chain of Agent2Agent calls -- support-triage hands
            off to order-lookup, which hands off to fraud-check, which hands off to refund-approval.
            Not HTTP calls with "A2A" in a comment: real message/send calls through agentgateway,
            carrying (and exchanging) the customer's identity at every hop.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Process a return</CardTitle>
            <CardDescription>
              Asks support-triage, as the logged-in customer from Stage 2, to handle a full return
              for order ORD-1006.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleAsk} disabled={asking} className="w-fit">
              {asking ? 'Processing…' : 'Process a return'}
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
        </Card>
      </motion.div>

      {response && response.steps.length > 0 && (
        <div className="flex flex-col gap-3">
          {response.steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.1 }}
            >
              <StepCard step={step} />
            </motion.div>
          ))}
        </div>
      )}

      {response && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Final outcome</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{response.replyText}</p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {response && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Badge>{response.steps.length} hop(s) traced</Badge>
          <ArrowRight className="size-3.5" />
          each one a real agent, not a mocked step.
        </p>
      )}

      {onNext && (
        <Button onClick={onNext} variant="secondary" className="self-end">
          Next <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

function StepCard({ step }: { step: ToolCallStep }) {
  const presentation = STEP_PRESENTATION[step.name] ?? { label: step.name, icon: PackageSearch }
  const Icon = presentation.icon
  const failed = Boolean(step.error)

  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        {failed ? (
          <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" />
        )}
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Icon className="size-3.5" />
            {presentation.label}
          </p>
          {failed ? (
            <p className="text-destructive text-xs">{step.error}</p>
          ) : (
            step.result !== undefined && (
              <pre className="bg-muted overflow-x-auto rounded-lg p-2 text-xs whitespace-pre-wrap">
                {typeof step.result === 'string'
                  ? step.result
                  : JSON.stringify(step.result, null, 2)}
              </pre>
            )
          )}
        </div>
      </CardContent>
    </Card>
  )
}
