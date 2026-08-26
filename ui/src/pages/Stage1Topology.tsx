import { motion } from 'framer-motion'
import { Bot, Database, Network, ShieldCheck } from 'lucide-react'
import { TopologyNode } from '@/components/topology-node'
import { ThemeToggle } from '@/components/theme-toggle'

/**
 * Stage1Topology is the guided tour's opening "meet the stack" view: a
 * static illustration of an agent calling an MCP server through
 * agentgateway, cataloged by agentregistry. There's no live data or event
 * stream yet -- that lands in a later phase once the telemetry stage exists.
 */
export function Stage1Topology() {
  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col items-center gap-12 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent text-sm font-medium">Stage 1</p>
          <h1 className="text-2xl font-semibold">Meet the stack</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            An AI agent handling a customer return, backed by a real MCP tool-calling substrate.
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

        <motion.div
          aria-hidden
          initial={{ opacity: 0, scaleY: 0 }}
          animate={{ opacity: 1, scaleY: 1 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="bg-border h-8 w-px origin-top"
        />

        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
          <TopologyNode
            icon={Bot}
            title="support-triage"
            subtitle="Looks up a customer's order"
            badge="Agent"
            delay={0.3}
          />

          <Arrow delay={0.5} />

          <TopologyNode
            icon={ShieldCheck}
            title="agentgateway"
            subtitle="Single enforcement point for policy"
            badge="Data plane"
            delay={0.7}
          />

          <Arrow delay={0.9} />

          <TopologyNode
            icon={Database}
            title="order-db"
            subtitle="Serves order lookup tools"
            badge="MCP server"
            delay={1.1}
          />
        </div>
      </div>
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
      className="text-muted-foreground flex items-center justify-center px-1 text-lg sm:rotate-0"
    >
      <span className="sm:hidden">↓</span>
      <span className="hidden sm:inline">→</span>
    </motion.div>
  )
}
