import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Code2, ShieldX, XCircle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import type { StageProps } from '@/pages/stage-props'

interface McpTool {
  name: string
  description?: string
}

interface CodemodeComparison {
  before: McpTool[]
  after: McpTool[]
}

interface ToolCallStep {
  name: string
  args?: unknown
  result?: unknown
  error?: string
}

interface DenyCheckResponse {
  replyText: string
  steps: ToolCallStep[]
}

/**
 * Stage5ToolPolicy is the guided tour's fifth stop, "Stage 4" in the design
 * doc's capability numbering, with two independent sub-scenes:
 *
 * 1. Tool policy: a fixed, low-value demo order (ORD-1002, $12.50) routed
 *    through the full support-triage -> ... -> refund-approval chain.
 *    refund-approval calls refund_payment directly (well under its own $75
 *    ask_user threshold, so no elicitation happens here) -- agentgateway's
 *    identity-based mcp.authorization Deny policy (agentic-field-kit's
 *    mcp-tool-policy feature, 'customers' in jwt.Groups) blocks the call
 *    regardless of amount or what the LLM decided. Originally dropped after
 *    an extended live-debugging investigation seemed to show the mechanism
 *    couldn't block tools/call at all; a later re-verification (see
 *    agentic-field-kit's docs/superpowers/plans/2026-08-27-retail-returns-
 *    phase6-tool-policy.md, "Eighth note") found the earlier conclusion was a
 *    test-harness artifact, not a gateway bug -- the Deny genuinely blocks
 *    the call (an MCP-layer "Unknown tool" error, since the denied tool is
 *    simply absent from the gateway's per-session view).
 * 2. Progressive disclosure: order-db-mcp's tool catalog collapsed into one
 *    code-execution meta-tool via entMcp.codeMode.
 */
export function Stage5ToolPolicy({ onNext }: StageProps) {
  const [comparison, setComparison] = useState<CodemodeComparison | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

  const [denyResponse, setDenyResponse] = useState<DenyCheckResponse | null>(null)
  const [denyError, setDenyError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

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

  async function handleDenyCheck() {
    setChecking(true)
    setDenyError(null)
    try {
      const res = await fetch('/api/stage-tool-policy/ask', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setDenyResponse(body)
    } catch (err) {
      setDenyError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent text-sm font-medium">Stage 4</p>
          <h1 className="text-2xl font-semibold">Tool policy &amp; progressive disclosure</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            Two independent gateway-level controls: a hard identity-based deny on refund_payment
            that no agent instruction can talk around, and order-db-mcp's tool catalog collapsed
            into a single code-execution meta-tool via entMcp.codeMode.
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
            <CardTitle className="flex items-center gap-2">
              <ShieldX className="size-4" /> Attempt a refund
            </CardTitle>
            <CardDescription>
              Asks support-triage to process a return for a low-value order (ORD-1002, $12.50) via
              the full A2A chain -- well under refund-approval's own $75 ask_user threshold, so no
              human input is needed here. refund-approval calls refund_payment directly, and
              agentgateway independently blocks it: the customer's own identity can never directly
              execute a real money movement, regardless of amount or what the LLM decided.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleDenyCheck} disabled={checking} className="w-fit">
              {checking ? 'Processing…' : 'Attempt refund for ORD-1002'}
            </Button>
            {denyError && <p className="text-destructive text-sm">{denyError}</p>}
            {denyResponse && (
              <div className="flex flex-col gap-3">
                {denyResponse.steps.map((step, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.1 }}
                  >
                    <ToolCallStepCard step={step} />
                  </motion.div>
                ))}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Final outcome</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{denyResponse.replyText}</p>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code2 className="size-4" /> Compare tool catalogs
            </CardTitle>
            <CardDescription>
              Live-queried from both routes, not hardcoded. At this demo's scale (2 tools) the
              difference is modest; the mechanism matters more at real-world scale with dozens of
              tools.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button onClick={handleCompare} disabled={comparing} className="w-fit">
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

function ToolCallStepCard({ step }: { step: ToolCallStep }) {
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
          <p className="font-mono text-sm font-medium">{step.name}</p>
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
