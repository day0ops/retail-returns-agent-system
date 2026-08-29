import { motion } from 'framer-motion'
import { ArrowRight, Bot, Database, Network, Server, ShieldCheck } from 'lucide-react'
import { TopologyNode } from '@/components/topology-node'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import type { StageProps } from '@/pages/stage-props'

/**
 * Stage1Topology is the guided tour's opening "meet the stack" view: a
 * static illustration of an agent calling an MCP server through
 * agentgateway, cataloged by agentregistry, running on kagent. There's no
 * live data or event stream yet -- that lands in a later phase once the
 * telemetry stage exists.
 */
export function Stage1Topology({ onNext }: StageProps) {
  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col items-center gap-12 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 1</p>
          <h1 className="text-2xl font-semibold">Meet the stack</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            An AI agent handling a customer return, backed by a real agent-to-MCP integration.
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

        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
          <TopologyNode
            icon={Bot}
            title="support-triage"
            subtitle="Looks up a customer's order"
            badge="Agent"
            delay={0.6}
          />

          <Arrow delay={0.8} />

          <TopologyNode
            icon={ShieldCheck}
            title="agentgateway"
            subtitle="Every agent ↔ MCP call routes through here"
            badge="Data plane"
            delay={1.0}
          />

          <Arrow delay={1.2} />

          <TopologyNode
            icon={Database}
            title="order-db"
            subtitle="Serves order lookup tools"
            badge="MCP server"
            delay={1.4}
          />
        </div>
      </div>

      {onNext && (
        <Button onClick={onNext} variant="secondary" className="self-end">
          Next: Identity & token exchange <ArrowRight className="size-3.5" />
        </Button>
      )}
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
