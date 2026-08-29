import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Code2,
  ShieldX,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
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

interface DirectCheck {
  blocked: boolean
  detail: string
}

interface DenyCheckResponse {
  replyText: string
  steps: ToolCallStep[]
  directCheck: DirectCheck
}

/**
 * Stage5ToolPolicy is the guided tour's fifth stop, with two independent
 * sub-scenes:
 *
 * 1. Tool policy (clickops): a presenter's "Apply policy" / "Remove policy"
 *    button controls whether agentgateway's identity-based mcp.authorization
 *    Deny policy ('customers' in jwt.Groups on refund_payment) actually
 *    exists in the cluster, via stage-policy-controller (an internal,
 *    non-customer-facing service the BFF calls). Deliberately NOT
 *    pre-provisioned: the Deny can only express an identity check, never an
 *    amount check (call arguments are never populated at authorization-check
 *    time), so it's indiscriminate across every customer-identity
 *    refund_payment call in the whole demo -- pre-provisioning it
 *    unconditionally would silently change Stage 4's own outcome before a
 *    presenter ever reaches this stage. Once applied, a fixed low-value demo
 *    order (ORD-1002, $12.50) is routed through the full support-triage ->
 *    ... -> refund-approval chain (well under refund-approval's own $75
 *    ask_user threshold, so no elicitation happens here). Confirmed live
 *    (agentic-field-kit's docs/superpowers/plans/2026-08-27-retail-returns-
 *    phase6-tool-policy.md, "Eighth note") that the Deny genuinely blocks
 *    the call once applied (an MCP-layer "Unknown tool" error, since the
 *    denied tool is simply absent from the gateway's per-session view) --
 *    an earlier investigation's "doesn't work" conclusion was a
 *    test-harness artifact, not a gateway bug.
 * 2. Progressive disclosure: order-db-mcp's tool catalog collapsed into one
 *    code-execution meta-tool via entMcp.codeMode.
 */
export function Stage5ToolPolicy({ onNext, onBack }: StageProps) {
  const [comparison, setComparison] = useState<CodemodeComparison | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

  const [denyResponse, setDenyResponse] = useState<DenyCheckResponse | null>(null)
  const [denyError, setDenyError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  // null while the initial status fetch is in flight -- distinct from
  // false, so the buttons don't flash an incorrect state on page load.
  const [policyApplied, setPolicyApplied] = useState<boolean | null>(null)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [policyBusy, setPolicyBusy] = useState(false)

  const [specExpanded, setSpecExpanded] = useState(false)
  const [spec, setSpec] = useState<unknown>(null)
  const [specError, setSpecError] = useState<string | null>(null)
  const [specLoading, setSpecLoading] = useState(false)

  useEffect(() => {
    fetch('/api/stage-tool-policy/policy-status')
      .then((res) => res.json())
      .then((body) => setPolicyApplied(Boolean(body.applied)))
      .catch((err) => setPolicyError(err instanceof Error ? err.message : String(err)))
  }, [])

  async function fetchSpec() {
    setSpecLoading(true)
    setSpecError(null)
    try {
      const res = await fetch('/api/stage-tool-policy/policy-spec')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setSpec(body.spec)
    } catch (err) {
      setSpecError(err instanceof Error ? err.message : String(err))
    } finally {
      setSpecLoading(false)
    }
  }

  function toggleSpec() {
    const next = !specExpanded
    setSpecExpanded(next)
    if (next) fetchSpec()
  }

  async function handlePolicyToggle(action: 'apply-policy' | 'remove-policy') {
    setPolicyBusy(true)
    setPolicyError(null)
    try {
      const res = await fetch(`/api/stage-tool-policy/${action}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setPolicyApplied(Boolean(body.applied))
      if (specExpanded) fetchSpec()
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : String(err))
    } finally {
      setPolicyBusy(false)
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
          <p className="text-accent-foreground text-sm font-medium">Stage 5</p>
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
              <ShieldX className="size-4" /> Refund identity policy
            </CardTitle>
            <CardDescription>
              A hard identity-based deny on refund_payment, enforced at agentgateway independent of
              what the LLM decides -- the customer's own identity can never directly execute a real
              money movement, regardless of amount. Applied on demand, not pre-provisioned: it can't
              be scoped to just this demo order, so it's off until you turn it on here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => handlePolicyToggle('apply-policy')}
                    disabled={policyBusy || policyApplied === true}
                    variant="outline"
                    className="w-fit"
                  >
                    {policyBusy ? 'Working…' : 'Apply policy'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Creates agentgateway's Deny policy (mcp.tool.name == 'refund_payment' &amp;&amp;
                  'customers' in jwt.Groups) on payment-mcp's live Backend.
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => handlePolicyToggle('remove-policy')}
                    disabled={policyBusy || policyApplied === false}
                    variant="outline"
                    className="w-fit"
                  >
                    {policyBusy ? 'Working…' : 'Remove policy'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Deletes the Deny policy -- refund_payment becomes callable by any customer
                  identity again, as it was before this stage.
                </TooltipContent>
              </Tooltip>
              {policyApplied !== null && (
                <Badge variant={policyApplied ? 'destructive' : 'secondary'} className="gap-1">
                  {policyApplied ? (
                    <ShieldX className="size-3" />
                  ) : (
                    <ShieldCheck className="size-3" />
                  )}
                  {policyApplied ? 'Policy applied' : 'Policy not applied'}
                </Badge>
              )}
            </div>
            {policyError && <p className="text-destructive text-sm">{policyError}</p>}

            <Button onClick={toggleSpec} variant="ghost" size="sm" className="w-fit">
              {specExpanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              {specExpanded ? 'Hide policy spec' : 'View policy spec'}
            </Button>
            {specExpanded && (
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs">
                  spec: down for the real EnterpriseAgentgatewayPolicy object --{' '}
                  {policyApplied ? 'currently live' : 'what applying would create (not live yet)'}.
                </p>
                {specLoading && <p className="text-muted-foreground text-xs">Loading…</p>}
                {specError && <p className="text-destructive text-xs">{specError}</p>}
                {spec != null && (
                  <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                    {JSON.stringify(spec, null, 2)}
                  </pre>
                )}
              </div>
            )}

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
                    <CardTitle className="text-sm">Final outcome (from the agent chain)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{denyResponse.replyText}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex items-start gap-3 py-4">
                    {denyResponse.directCheck.blocked ? (
                      <ShieldX className="text-destructive mt-0.5 size-4 shrink-0" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" />
                    )}
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium">
                        {denyResponse.directCheck.blocked
                          ? 'Gateway check: refund_payment blocked'
                          : 'Gateway check: refund_payment allowed'}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        A direct refund_payment call (this BFF, same identity, same route) --
                        agentgateway's own response, not the agent's interpretation of it.
                      </p>
                      <pre className="bg-muted overflow-x-auto rounded-lg p-2 text-xs whitespace-pre-wrap">
                        {denyResponse.directCheck.detail}
                      </pre>
                    </div>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="text-muted-foreground size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  entMcp.codeMode collapses order-db-mcp's individual tool schemas into a single
                  code-execution meta-tool -- fewer tokens for the LLM to read as a real catalog
                  grows to dozens of tools, at the cost of the model writing code instead of calling
                  tools directly.
                </TooltipContent>
              </Tooltip>
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

      <StageFooterNav onBack={onBack} onNext={onNext} />
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
            <span className="text-accent-foreground font-mono font-medium">{tool.name}</span>
            {tool.description && <p className="text-muted-foreground mt-0.5">{tool.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
