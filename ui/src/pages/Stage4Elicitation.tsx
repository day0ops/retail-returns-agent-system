import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, HelpCircle, PauseCircle } from 'lucide-react'
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
  questions: AskUserQuestion[]
}

type AskOutcome =
  | { kind: 'input-required'; pending: PendingQuestion }
  | { kind: 'completed'; replyText: string; steps: unknown[] }

const ASK_PROMPT = 'I want to return order ORD-1001 for a refund. Please process the full return.'

/**
 * Stage4Elicitation is the guided tour's fourth stop, "Stage 3" in the design
 * doc's capability numbering (elicitation): refund-approval pauses mid-chain
 * and asks the customer a real question -- kagent's ask_user tool, not a
 * scripted client-side confirm() dialog. ORD-1001's $89.99 order crosses the
 * $75 threshold that triggers it, reusing the same chain as the A2A handoff
 * stage. kagent's HITL machinery propagates the pause up through every A2A
 * hop, so support-triage's own top-level task -- the only thing this page's
 * BFF calls talk to -- genuinely enters the paused state.
 */
export function Stage4Elicitation({ onNext }: StageProps) {
  const [outcome, setOutcome] = useState<AskOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAsk() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage-elicitation/ask', {
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
      const res = await fetch('/api/stage-elicitation/answer', {
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

  const pending = outcome?.kind === 'input-required' ? outcome.pending : null
  const completed = outcome?.kind === 'completed' ? outcome : null

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent text-sm font-medium">Stage 3</p>
          <h1 className="text-2xl font-semibold">Elicitation</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            When a refund exceeds $75, refund-approval doesn't decide alone -- it pauses mid-task
            and asks the customer a real question (kagent's ask_user tool), several A2A hops deep in
            the chain, then resumes once answered.
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
              Order ORD-1001 ($89.99) crosses the elicitation threshold, so this run should pause.
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
                refund-approval can't continue without this. The task is genuinely suspended, not
                just showing a spinner.
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
          <Badge>Resumed after a real pause</Badge>
          <ArrowRight className="size-3.5" />
          your answer changed what refund-approval actually did.
        </p>
      )}

      {onNext && (
        <Button onClick={onNext} variant="secondary" className="self-end">
          Next <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
