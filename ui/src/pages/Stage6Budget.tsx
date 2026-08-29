import { useState } from 'react'
import { motion } from 'framer-motion'
import { Coins, DollarSign, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import type { StageProps } from '@/pages/stage-props'

interface PaidCallResult {
  status: number
  ok: boolean
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  error?: string
  budgetHeaders: Record<string, string>
}

interface CustomerState {
  loggedIn: boolean
  busy: boolean
  error: string | null
  calls: PaidCallResult[]
}

const emptyState: CustomerState = { loggedIn: false, busy: false, error: null, calls: [] }

/**
 * Stage6Budget is the guided tour's sixth stop: per-customer LLM spend budgets enforced at
 * agentgateway (EnterpriseAgentgatewayBudget + entBudgetEnforcement on the
 * shared openai backend), keyed on the customerEmail request dimension
 * (jwt.email) rather than jwt.sub -- see agentic-field-kit's budget-policy
 * feature and its plan doc for why.
 *
 * Two real demo customers, same mechanism, different onBudgetExceeded modes:
 * customer1 is capped on Tokens and set to Block -- a single normal call only
 * spends ~40 of its 200-token cap, so its button fires 10 sequential calls
 * (not just one) to cross it; customer2 is capped on USD and set to Audit,
 * which never blocks -- a single call can't demonstrate anything, so its
 * button fires a batch of concurrent long-response calls to approach/cross
 * the $ cap in one click instead of dozens of manual ones. Confirmed live
 * that Audit-mode budgets never attach any distinguishing response header
 * even well past the cap, so this stage doesn't claim header-level proof for
 * that card -- only the behavioral contrast (blocked vs. not) is real,
 * verifiable proof here. Also confirmed live that Block-mode enforcement
 * isn't a simple monotonic "blocked forever the instant the sum crosses 200"
 * -- a rapid sequential burst can show an occasional success mixed in among
 * blocks (some refill/timing behavior internal to agentgateway's own
 * enforcement). Customer 1's button always runs the full batch rather than
 * stopping at the first block, so the aggregate "N/10 succeeded" stays
 * accurate and unambiguous regardless of any mid-batch jitter.
 */
export function Stage6Budget({ onNext, onBack }: StageProps) {
  const [customer1, setCustomer1] = useState<CustomerState>(emptyState)
  const [customer2, setCustomer2] = useState<CustomerState>(emptyState)

  async function login(customer: 'customer1' | 'customer2') {
    const set = customer === 'customer1' ? setCustomer1 : setCustomer2
    set((s) => ({ ...s, busy: true, error: null }))
    try {
      const res = await fetch('/api/stage-budget/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      set((s) => ({ ...s, loggedIn: true, busy: false }))
    } catch (err) {
      set((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }))
    }
  }

  async function makeCall(customer: 'customer1' | 'customer2') {
    const set = customer === 'customer1' ? setCustomer1 : setCustomer2
    set((s) => ({ ...s, busy: true, error: null }))
    try {
      const res = await fetch('/api/stage-budget/paid-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      set((s) => ({ ...s, busy: false, calls: body.calls }))
    } catch (err) {
      set((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }))
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 6</p>
          <h1 className="text-2xl font-semibold">Budget control</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            Two real customers, same mechanism (a per-customer LLM spend budget enforced at
            agentgateway), two outcomes when the cap is crossed.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <BudgetCard
          icon={<Coins className="size-4" />}
          title="Customer 1 — Tokens, Block"
          description="200 tokens/day. A single call only spends ~40 tokens, so this fires 10 sequential calls to cross the cap well within one click."
          state={customer1}
          onLogin={() => login('customer1')}
          onCall={() => makeCall('customer1')}
          callLabel="Make 10 paid calls"
        />
        <BudgetCard
          icon={<DollarSign className="size-4" />}
          title="Customer 2 — USD, Audit"
          description="$1/day. Audit never blocks, so this fires 25 concurrent long-response calls to cross the cap in one click."
          state={customer2}
          onLogin={() => login('customer2')}
          onCall={() => makeCall('customer2')}
          callLabel="Make 25 paid calls"
          auditNote="Every call succeeded despite generating far more spend than the $1 cap -- Audit mode logs the overage server-side instead of blocking traffic. Compare to Customer 1, whose calls actually stop once its Block-mode cap is hit."
        />
      </div>

      <StageFooterNav onBack={onBack} onNext={onNext} />
    </div>
  )
}

function BudgetCard({
  icon,
  title,
  description,
  state,
  onLogin,
  onCall,
  callLabel,
  auditNote,
}: {
  icon: React.ReactNode
  title: string
  description: string
  state: CustomerState
  onLogin: () => void
  onCall: () => void
  callLabel: string
  // Audit-mode budgets never block, so there's nothing to prove via a
  // blocked-call's headers -- shown instead of that once calls exist, since
  // agentgateway never attaches any distinguishing header for Audit mode
  // (confirmed live, even well past the $ cap: only the same generic,
  // irrelevant default rate-limit headers ever appear).
  auditNote?: string
}) {
  const blocked = state.calls.some((c) => !c.ok)
  const totalTokens = state.calls.reduce((sum, c) => sum + (c.usage?.total_tokens ?? 0), 0)
  // Only meaningful once a call is actually blocked -- headers on a
  // successful call are the same generic, irrelevant defaults regardless of
  // which budget (if any) is even configured, confirmed live.
  const budgetHeaders = blocked
    ? state.calls.find((c) => !c.ok && Object.keys(c.budgetHeaders).length > 0)?.budgetHeaders
    : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon} {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!state.loggedIn ? (
            <Button onClick={onLogin} disabled={state.busy} className="w-fit">
              {state.busy ? 'Logging in…' : 'Log in'}
            </Button>
          ) : (
            <Button onClick={onCall} disabled={state.busy} className="w-fit">
              {state.busy ? 'Calling…' : callLabel}
            </Button>
          )}
          {state.error && <p className="text-destructive text-sm">{state.error}</p>}
          {state.calls.length > 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="flex items-center gap-1.5">
                {blocked ? (
                  <ShieldAlert className="text-destructive size-3.5 shrink-0" />
                ) : (
                  <ShieldCheck className="size-3.5 shrink-0 text-green-600 dark:text-green-500" />
                )}
                {state.calls.filter((c) => c.ok).length}/{state.calls.length} calls succeeded
                {totalTokens > 0 && ` — ${totalTokens} tokens spent`}
              </p>
              {blocked && (
                <Badge variant="destructive" className="w-fit">
                  Budget exceeded
                </Badge>
              )}
              {budgetHeaders && (
                <pre className="bg-muted overflow-x-auto rounded-lg p-2 text-xs whitespace-pre-wrap">
                  {JSON.stringify(budgetHeaders, null, 2)}
                </pre>
              )}
              {!blocked && auditNote && (
                <p className="text-muted-foreground text-xs">{auditNote}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
