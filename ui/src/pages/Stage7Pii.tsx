import { useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Database, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { TopologyNode } from '@/components/topology-node'
import { StageFooterNav } from '@/components/stage-footer-nav'
import { PolicySpecViewer } from '@/components/policy-spec-viewer'
import type { StageProps } from '@/pages/stage-props'

interface OrderRecord {
  order_id: string
  customer_id: string
  customer_email: string
  customer_phone: string
  item: string
  amount: number
  status: string
  purchase_date: string
}

interface McpToolResult {
  structuredContent?: { order?: OrderRecord }
}

interface PiiComparison {
  raw: McpToolResult
  masked: McpToolResult
}

/**
 * Stage7Pii is the guided tour's seventh stop: PII masking / guardrails.
 *
 * A real get_order call for the same order, once direct to order-db-mcp's own
 * Service (raw -- agentgateway never sees it) and once through the actual
 * route the support-triage/order-lookup agents already use (now carrying
 * agentic-field-kit's pii-guardrail-policy CheckResponse hook). The masked
 * side is real live agent traffic's own protection, not a side-channel demo
 * route -- see agentic-field-kit's features/agentic/pii-guardrail-policy.
 */
export function Stage7Pii({ onNext, onBack }: StageProps) {
  const [comparison, setComparison] = useState<PiiComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleCompare() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage-pii/compare')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setComparison(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-7xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 7</p>
          <h1 className="text-2xl font-semibold">PII masking / guardrails</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            order-db-mcp's real tool result, fetched two ways: direct to its Service (raw), and
            through the same agentgateway route support-triage already uses (masked by an ExtMcp
            CheckResponse hook).
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
        <TopologyNode
          icon={Bot}
          title="support-triage"
          subtitle="Calls get_order"
          badge="Agent"
          delay={0}
        />
        <Arrow delay={0.2} />
        <TopologyNode
          icon={ShieldCheck}
          title="agentgateway"
          subtitle="Policy enforcement point"
          badge="Data plane"
          delay={0.4}
        />
        <Arrow delay={0.6} />
        <TopologyNode
          icon={EyeOff}
          title="pii-guardrail"
          subtitle="ExtMcp CheckResponse: masks PII"
          badge="Guardrail"
          delay={0.8}
        />
        <Arrow delay={1.0} />
        <TopologyNode
          icon={Database}
          title="order-db"
          subtitle="Serves the real (unmasked) order"
          badge="MCP server"
          delay={1.2}
        />
      </div>

      <PolicySpecViewer endpoint="/api/stage-pii/policy-spec" toggleLabel="guardrail policy spec" />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 1.4 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> Compare a real tool result
            </CardTitle>
            <CardDescription>
              get_order(ORD-1001) -- same order, same tool, two routes. No hardcoded example output.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button onClick={handleCompare} disabled={busy} className="w-fit">
              {busy ? 'Fetching…' : 'Fetch order (raw vs. masked)'}
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
            {comparison && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <OrderPanel
                  icon={<Eye className="size-3.5" />}
                  title="Raw (direct to order-db-mcp)"
                  order={comparison.raw.structuredContent?.order}
                />
                <OrderPanel
                  icon={<EyeOff className="size-3.5" />}
                  title="Masked (via agentgateway)"
                  order={comparison.masked.structuredContent?.order}
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

function Arrow({ delay }: { delay: number }) {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay }}
      className="text-accent-foreground flex items-center justify-center px-1 text-lg sm:rotate-0"
    >
      <span className="sm:hidden">↓</span>
      <span className="hidden sm:inline">→</span>
    </motion.div>
  )
}

function OrderPanel({
  icon,
  title,
  order,
}: {
  icon: React.ReactNode
  title: string
  order: OrderRecord | undefined
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {icon} {title}
      </p>
      {order ? (
        <dl className="bg-muted flex flex-col gap-1 rounded-lg p-3 text-xs">
          <Row label="email" value={order.customer_email} />
          <Row label="phone" value={order.customer_phone} />
          <Row label="item" value={order.item} />
          <Row label="status" value={order.status} />
        </dl>
      ) : (
        <p className="text-muted-foreground text-xs">No structured order in this result.</p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="truncate text-right font-mono">{value}</dd>
    </div>
  )
}
