import { motion } from 'framer-motion'
import { Bot, Database, Network, Server, ShieldCheck, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { TopologyNode } from '@/components/topology-node'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import { Badge } from '@/components/ui/badge'
import type { StageProps } from '@/pages/stage-props'

/**
 * Stage1Topology is the guided tour's opening "meet the stack" view: a
 * static illustration of an agent calling an MCP server through
 * agentgateway, cataloged by agentregistry, running on kagent. There's no
 * live data or event stream yet -- that lands in a later phase once the
 * telemetry stage exists.
 */
export function Stage1Topology({ onNext, onBack }: StageProps) {
  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col items-center gap-12 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 1</p>
          <h1 className="text-2xl font-semibold">Meet the stack</h1>
          <p className="text-muted-foreground mt-1 max-w-lg text-sm">
            support-triage, an AI agent, resolves a customer return by calling real MCP tool servers
            -- every piece below is live infrastructure, not a mock.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="flex w-full flex-col items-center gap-6">
        <TopologyNode
          icon={Network}
          title="agentregistry"
          subtitle="Catalogs every agent and MCP server"
          badge="Governance"
          delay={0}
        />

        <Connector delay={0.15} />

        <TopologyNode
          icon={Server}
          title="kagent"
          subtitle="Runs support-triage as a real workload"
          badge="Runtime"
          delay={0.3}
        />

        <Connector delay={0.45} />

        <div className="relative pb-14">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <div className="border-border/70 flex min-h-[450px] flex-col items-center gap-3 rounded-xl border border-dashed p-4">
              <p className="text-muted-foreground self-start text-[11px] font-semibold tracking-wide uppercase">
                Agents
              </p>
              <TopologyNode
                icon={Bot}
                title="support-triage"
                subtitle="Looks up a customer's order"
                badge="Agent"
                delay={0.6}
              />
              <div className="flex w-56 flex-col gap-2 pt-1">
                <MutedNode icon={Bot} title="order-lookup" subtitle="Order + shipping detail" />
                <MutedNode icon={Bot} title="fraud-check" subtitle="Transaction risk scoring" />
                <MutedNode
                  icon={Bot}
                  title="refund-approval"
                  subtitle="Payment method + refund processing"
                />
              </div>
              <p className="text-muted-foreground text-center text-[11px]">
                Full A2A chain revealed in Stage 3
              </p>
            </div>

            <Arrow delay={0.8} />

            <TopologyNode
              icon={ShieldCheck}
              title="agentgateway"
              subtitle="Every agent ↔ MCP call routes through here"
              badge="Data plane"
              delay={1.0}
            />

            <Arrow delay={1.2} />

            <div className="border-border/70 flex min-h-[450px] flex-col items-center gap-3 rounded-xl border border-dashed p-4">
              <p className="text-muted-foreground self-start text-[11px] font-semibold tracking-wide uppercase">
                MCP servers
              </p>
              <TopologyNode
                icon={Database}
                title="order-db"
                subtitle="Serves order lookup tools"
                badge="MCP server"
                delay={1.4}
              />
              <div className="flex w-56 flex-col gap-2 pt-1">
                <MutedNode
                  icon={Database}
                  title="payment-mcp"
                  subtitle="get_payment_method, refund_payment"
                />
                <MutedNode icon={Database} title="shipping-mcp" subtitle="get_shipment_status" />
                <MutedNode icon={Database} title="inventory-mcp" subtitle="check_stock" />
                <MutedNode icon={Database} title="fraud-scoring-mcp" subtitle="score_transaction" />
              </div>
              <p className="text-muted-foreground text-center text-[11px]">Used starting Stage 4</p>
            </div>
          </div>

          <BusConnector />
        </div>

        <Connector delay={1.6} />

        <FoundationLayer delay={1.75} />
      </div>

      <ComponentBreakdown />

      <StageFooterNav onBack={onBack} onNext={onNext} nextLabel="Next: Identity & token exchange" />
    </div>
  )
}

interface StackComponent {
  name: string
  badge: string
  description: string
}

const STACK_COMPONENTS: StackComponent[] = [
  {
    name: 'agentregistry',
    badge: 'Governance',
    description: 'Catalogs every agent and MCP server.',
  },
  { name: 'kagent', badge: 'Runtime', description: 'Runs agents as real Kubernetes workloads.' },
  { name: 'support-triage', badge: 'Agent', description: "Handles this stage's customer return." },
  {
    name: 'agentgateway',
    badge: 'Data plane',
    description: 'Routes and enforces every agent-to-MCP call.',
  },
  { name: 'order-db', badge: 'MCP server', description: 'Exposes order lookup tools.' },
  {
    name: 'Istio Ambient Mesh',
    badge: 'Foundation',
    description: 'The mesh everything above runs on.',
  },
]

// A compact legend below the diagram -- the diagram itself already carries a
// one-line subtitle per node, this spells out what each role (agent vs. MCP
// server vs. control/data plane) actually means, in one place.
function ComponentBreakdown() {
  return (
    <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
      {STACK_COMPONENTS.map((c) => (
        <div key={c.name} className="flex items-start gap-3">
          <Badge variant="secondary" className="w-24 shrink-0 justify-center">
            {c.badge}
          </Badge>
          <div className="flex flex-col">
            <p className="font-mono text-sm font-medium">{c.name}</p>
            <p className="text-muted-foreground text-xs">{c.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// A deliberately de-emphasized row (not a TopologyNode card) for components
// that are real and deployed but outside Stage 1's own walking-skeleton
// focus (support-triage <-> order-db) -- shown by name so the full roster
// is visible, without competing for attention with the highlighted pair.
function MutedNode({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
}) {
  return (
    <div className="flex items-center gap-2 opacity-50">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <div className="flex flex-col text-left">
        <p className="font-mono text-xs font-medium">{title}</p>
        <p className="text-muted-foreground text-[11px]">{subtitle}</p>
      </div>
    </div>
  )
}

// A bus-style connector below the row: a stem drops from agentgateway's
// bottom edge to a shared horizontal bar, which then ticks up into each
// framed group's bottom edge -- signals that the whole group (including the
// dimmed agents/MCP servers) connects through agentgateway, not just the
// highlighted pair the solid arrows above already show. Both frames share a
// fixed min-height (see their className below) specifically so this stays
// symmetric regardless of how the muted subtitles wrap -- the two frames'
// real bottoms landed at different y's before that fix (measured via
// Playwright boundingBox(), not eyeballed), which visibly missed the
// shorter frame's border. Pixel offsets below are those same measured
// values (row width/positions are fixed, not percentage-responsive) --
// intentionally desktop-only (hidden below the sm: breakpoint, where the
// row itself collapses to a single stacked column and this geometry no
// longer applies).
function BusConnector() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
      <div className="bg-accent-foreground absolute top-[200px] left-[442px] h-[262px] w-0.5 -translate-x-1/2" />
      <div className="bg-accent-foreground absolute top-[462px] left-[129px] h-0.5 w-[626px]" />
      <div className="bg-accent-foreground absolute top-[450px] left-[129px] h-3 w-0.5 -translate-x-1/2" />
      <div className="bg-accent-foreground absolute top-[450px] left-[755px] h-3 w-0.5 -translate-x-1/2" />
      {/* Continues past this wrapper's own height (overflow is visible, not
          clipped) most of the way down to the Foundation/Ambient card --
          closes what would otherwise be a large visible break, while still
          stopping short of the card by the same ~24px gap every other
          Connector on this page leaves before the box it leads into
          (measured from the agentregistry->kagent gap, not guessed). */}
      <div className="bg-accent-foreground absolute top-[462px] left-[442px] h-[116px] w-0.5 -translate-x-1/2" />
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

function Connector({ delay }: { delay: number }) {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{ duration: 0.3, delay }}
      className="bg-accent-foreground h-8 w-px origin-top"
    />
  )
}

// A wide plate rather than a same-sized TopologyNode card -- Ambient is the
// data-plane substrate everything above runs on, not a peer component you'd
// call directly, so it reads as a foundation, not another node in the chain.
function FoundationLayer({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className="border-border bg-card flex w-full max-w-3xl items-center gap-3 rounded-xl border px-5 py-4"
    >
      <div className="bg-accent/10 text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
        <Waves className="size-5" />
      </div>
      <div className="flex flex-1 flex-col">
        <p className="font-semibold">Istio Ambient Mesh</p>
        <p className="text-muted-foreground text-sm">
          The L4/L7 data plane every hop above actually runs on (ztunnel + waypoint).
        </p>
      </div>
      <Badge variant="secondary">Foundation</Badge>
    </motion.div>
  )
}
