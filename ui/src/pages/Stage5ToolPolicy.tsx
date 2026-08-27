import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Code2 } from 'lucide-react'
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

/**
 * Stage5ToolPolicy is the guided tour's fifth stop, "Stage 4" in the design
 * doc's capability numbering: progressive disclosure only for now.
 *
 * This stage originally also demonstrated a hard $ cap on refund_payment via
 * mcp.authorization (Deny), enforced at agentgateway independent of what the
 * customer or the LLM decided. Dropped after exhaustive live verification --
 * amount-based CEL, identity-based CEL, and even an unconditional
 * tool-name-only deny all failed to block a single call, at both the
 * previously-pinned agentgateway version and after bumping to v2026.8.2
 * (which does add real tools/call enforcement per the source and docs, just
 * apparently not working as documented in this deployment). Every layer of
 * the pipeline checks out correct in isolation (CRD, Go controller
 * translation, live /config_dump, source call site, trace logs correlated to
 * the actual request) -- looks like an upstream agentgateway-enterprise bug,
 * to be raised separately. Full verification chain in agentic-field-kit's
 * docs/superpowers/plans/2026-08-27-retail-returns-phase6-tool-policy.md.
 */
export function Stage5ToolPolicy({ onNext }: StageProps) {
  const [comparison, setComparison] = useState<CodemodeComparison | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)

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

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent text-sm font-medium">Stage 4</p>
          <h1 className="text-2xl font-semibold">Progressive disclosure</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            order-db-mcp exposed a second time, with entMcp.codeMode enabled -- its tool catalog
            collapsed into a single code-execution meta-tool instead of many individually-described
            tool schemas.
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
