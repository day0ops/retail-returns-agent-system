import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, ExternalLink, MessageSquare, Wrench } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import type { StageProps } from '@/pages/stage-props'

interface SessionSummary {
  windowMinutes: number
  mcp: { totalCalls: number; blockedCalls: number; backendsTouched: string[] }
  llm: { totalCalls: number; totalTokens: number }
  grafanaUrl: string
}

/**
 * Stage8Telemetry is the guided tour's eighth and final stop: a session
 * recap queried live from Loki, not a mocked summary. agentgateway's
 * access-log policy (agentic-field-kit's telemetry addon, already applied
 * cluster-wide) fans every request from every stage above into Loki with a
 * rich attribute set (llm.*_tokens, mcp.tool.name/target, jwt claims) --
 * this stage is the first to actually read any of it back.
 */
export function Stage8Telemetry({ onBack }: StageProps) {
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function fetchSummary() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stage8/session-summary')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setSummary(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 8</p>
          <h1 className="text-2xl font-semibold">Session telemetry</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            Everything in Stages 1-7 left a real trace -- agentgateway's access-log policy fans
            every request into Loki. This recap is queried live, not a mocked summary.
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
              <Activity className="size-4" /> Session recap
            </CardTitle>
            <CardDescription>
              This customer's own traffic over the last {summary?.windowMinutes ?? 15} minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button onClick={fetchSummary} disabled={loading} className="w-fit">
              {loading ? 'Querying Loki…' : summary ? 'Refresh recap' : 'Fetch session recap'}
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
            {summary && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard
                  icon={<Wrench className="size-3.5" />}
                  label="MCP tool calls"
                  value={String(summary.mcp.totalCalls)}
                  note={
                    summary.mcp.blockedCalls > 0
                      ? `${summary.mcp.blockedCalls} blocked`
                      : summary.mcp.backendsTouched.length > 0
                        ? summary.mcp.backendsTouched.join(', ')
                        : 'none yet -- try Stage 2 or 3'
                  }
                />
                <StatCard
                  icon={<MessageSquare className="size-3.5" />}
                  label="LLM calls"
                  value={String(summary.llm.totalCalls)}
                  note={`${summary.llm.totalTokens} tokens spent`}
                />
              </div>
            )}
            {summary && (
              <Button asChild variant="outline" className="w-fit">
                <a href={summary.grafanaUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> View full trace in Grafana
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <StageFooterNav onBack={onBack} />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode
  label: string
  value: string
  note: string
}) {
  return (
    <div className="bg-muted flex flex-col gap-1 rounded-lg p-3">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {icon} {label}
      </p>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
  )
}
