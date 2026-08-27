import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  HelpCircle,
  PauseCircle,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import type { StageProps } from '@/pages/stage-props'

interface AskUserQuestion {
  question: string
  choices?: string[]
  multiple?: boolean
}

interface PendingQuestion {
  taskId: string
  contextId: string
  confirmationId: string
  payload: Record<string, unknown>
  questions: AskUserQuestion[]
}

interface ToolCallStep {
  name: string
  args?: unknown
  result?: unknown
  error?: string
}

type AskOutcome =
  | { kind: 'input-required'; pending: PendingQuestion }
  | { kind: 'completed'; replyText: string; steps: ToolCallStep[] }

interface McpTool {
  name: string
  description?: string
}

interface CodemodeComparison {
  before: McpTool[]
  after: McpTool[]
}

// ORD-1009's $649.99 crosses both refund-approval's own $75 ask_user threshold
// (Stage 3) and agentgateway's separate $500 hard cap on refund_payment
// (this stage), so both controls fire in sequence: the customer still picks a
// refund method, but the actual payment call gets denied at the gateway
// regardless of that choice.
const ASK_PROMPT =
  'Process a return for order ORD-1009: Home Theater Projector, purchased for $649.99 ' +
  'on 2026-07-25, delivered by FastShip (tracking FS100900), for customer CUST-100. ' +
  'Please process the full refund.'

/**
 * Stage5ToolPolicy is the guided tour's fifth stop, "Stage 4" in the design
 * doc's capability numbering (tool policy): agentgateway enforces a hard
 * dollar cap on refund_payment (mcp.authorization, Deny) independent of what
 * the customer chooses or the LLM decides. Real tools/call enforcement (not
 * just tools/list visibility filtering) and a populated mcp.tool.arguments
 * CEL context both require agentgateway v2026.8.2 -- confirmed absent at
 * v2026.7.1-patch.1/v2026.8.0/v2026.8.1 by bisecting agentgateway-enterprise's
 * own source (see agentic-field-kit's env.agentgateway.version comment and
 * design doc "Confirmed CRD schemas" correction). Same single-hop shape as
 * Stage 3 (elicitation) and the same reason -- calls refund-approval directly,
 * not through support-triage's full chain, since a kagent SDK bug means
 * nested A2A HITL resume forwarding only works reliably for the first hop an
 * external client resumes (see agentic-field-kit's design doc "Known issues
 * to revisit"). This stage's order (ORD-1009, $649.99) crosses Stage 3's own
 * $75 ask_user threshold too, so both controls run in sequence: the human
 * still gets asked for a refund method, then the gateway independently blocks
 * the actual payment above $500 -- two stacked controls, not a duplicate of
 * Stage 3.
 */
export function Stage5ToolPolicy({ onNext }: StageProps) {
  const [outcome, setOutcome] = useState<AskOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [comparison, setComparison] = useState<CodemodeComparison | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

  async function handleAsk() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage-tool-policy/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: ASK_PROMPT }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setOutcome(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleAnswer(answer: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage-tool-policy/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setOutcome(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleCompare() {
    setComparing(true)
    setComparisonError(null)
    try {
      const res = await fetch('/api/stage-tool-policy/codemode-comparison')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setComparison(body)
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : String(err))
    } finally {
      setComparing(false)
    }
  }

  const pending = outcome?.kind === 'input-required' ? outcome.pending : null
  const completed = outcome?.kind === 'completed' ? outcome : null
  const refundStep = completed?.steps.find((s) => s.name === 'refund_payment')

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent text-sm font-medium">Stage 4</p>
          <h1 className="text-2xl font-semibold">Tool policy</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            Above $500, agentgateway itself denies the refund_payment call -- a gateway-enforced cap
            no agent instruction can override, independent of the refund method the customer
            chooses.
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
              Order ORD-1009 ($649.99) crosses both the elicitation threshold and the gateway's $500
              refund cap.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleAsk} disabled={busy || Boolean(outcome)} className="w-fit">
              {busy && !outcome ? 'Processing…' : 'Process a return'}
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
        </Card>
      </motion.div>

      {pending && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PauseCircle className="size-4" /> Paused -- waiting for your answer
              </CardTitle>
              <CardDescription>
                Same human-in-the-loop step as Stage 3 -- the customer still picks a refund method
                before anything else happens.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {pending.questions.map((q, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <HelpCircle className="size-3.5" />
                    {q.question}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(q.choices ?? ['Yes', 'No']).map((choice) => (
                      <Button
                        key={choice}
                        variant="secondary"
                        disabled={busy}
                        onClick={() => handleAnswer(choice)}
                      >
                        {choice}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {refundStep && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardContent className="flex items-start gap-3 py-4">
              {refundStep.error ? (
                <ShieldAlert className="text-destructive mt-0.5 size-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" />
              )}
              <div className="flex flex-col gap-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {refundStep.error ? (
                    <>
                      <XCircle className="size-3.5" /> refund_payment denied by agentgateway
                    </>
                  ) : (
                    'refund_payment succeeded'
                  )}
                </p>
                <pre className="bg-muted overflow-x-auto rounded-lg p-2 text-xs whitespace-pre-wrap">
                  {refundStep.error ??
                    (typeof refundStep.result === 'string'
                      ? refundStep.result
                      : JSON.stringify(refundStep.result, null, 2))}
                </pre>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {completed && (
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
              <p className="text-sm">{completed.replyText}</p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {completed && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Badge>Enforced at the gateway</Badge>
          <ArrowRight className="size-3.5" />
          not something refund-approval's own instructions decided.
        </p>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code2 className="size-4" /> Progressive disclosure
            </CardTitle>
            <CardDescription>
              order-db-mcp exposed a second time, with entMcp.codeMode enabled -- its tool catalog
              collapsed into a single code-execution meta-tool. Live-queried from both routes, not
              hardcoded. At this demo's scale (2 tools) the difference is modest; the mechanism
              matters more at real-world scale with dozens of tools.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              onClick={handleCompare}
              disabled={comparing}
              variant="secondary"
              className="w-fit"
            >
              {comparing ? 'Comparing…' : 'Compare tool catalogs'}
            </Button>
            {comparisonError && <p className="text-destructive text-sm">{comparisonError}</p>}
            {comparison && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ToolList
                  title={`Without codeMode (${comparison.before.length} tools)`}
                  tools={comparison.before}
                />
                <ToolList
                  title={`With codeMode (${comparison.after.length} tool)`}
                  tools={comparison.after}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {onNext && (
        <Button onClick={onNext} variant="secondary" className="self-end">
          Next <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

function ToolList({ title, tools }: { title: string; tools: McpTool[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {tools.map((tool) => (
          <li key={tool.name} className="bg-muted rounded-lg p-2 text-xs">
            <span className="font-mono font-medium">{tool.name}</span>
            {tool.description && <p className="text-muted-foreground mt-0.5">{tool.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
