import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, Link2, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { StageFooterNav } from '@/components/stage-footer-nav'
import { SequenceDiagram, type SequenceStep } from '@/components/sequence-diagram'
import type { StageProps } from '@/pages/stage-props'

const DEMO_ORDER_ID = 'ORD-1001'

interface OAuthProviderInfo {
  clientId: string
  authorizeUrl: string
  redirectUri: string
  scopes: string[]
}

interface PendingElicitation {
  id: number
  resource: string
  oauth: OAuthProviderInfo
}

interface LinkResult {
  linked: boolean
  carrier: string
  message: string
}

type Phase = 'idle' | 'elicitation-required' | 'consenting' | 'linked'

/**
 * Stage9CarrierElicitation is the guided tour's ninth stop: agentgateway's own
 * `entElicitation` mechanism, not kagent's `ask_user` (Stage 4) and not the RFC 8693
 * exchange (Stage 2). The first time this customer needs a carrier pickup scheduled,
 * carrier-mcp's linkCarrierAccount call is gated by agentgateway before it ever reaches
 * the MCP server -- a real HTTP 400 with the third-party OAuth provider's details, not a
 * simulated pause. Completing the popup consent hands a real authorization code back to
 * the controller's own STS, which exchanges it server-side and banks the resulting
 * token; the retried call only succeeds because that token now exists. See
 * agentic-field-kit's Phase 9 plan doc for the live-verified mechanism this wraps.
 */
export function Stage9CarrierElicitation({ onNext, onBack }: StageProps) {
  const [flowExpanded, setFlowExpanded] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [elicitation, setElicitation] = useState<PendingElicitation | null>(null)
  const [result, setResult] = useState<LinkResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const popupRef = useRef<Window | null>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as { source?: string; code?: string | null; error?: string | null }
      if (data?.source !== 'stage9-carrier-callback') return
      popupRef.current?.close()
      if (data.error) {
        setError(`Carrier consent failed: ${data.error}`)
        setPhase('elicitation-required')
        return
      }
      if (data.code) void handleComplete(data.code)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elicitation])

  async function handleLinkCarrier() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage9/link-carrier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: DEMO_ORDER_ID }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      if (body.kind === 'linked') {
        setResult(body.result)
        setPhase('linked')
        return
      }
      setElicitation(body.elicitation)
      setPhase('elicitation-required')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function handleOpenConsent() {
    if (!elicitation) return
    const { oauth } = elicitation
    const params = new URLSearchParams({
      client_id: oauth.clientId,
      redirect_uri: oauth.redirectUri,
      response_type: 'code',
      scope: oauth.scopes.join(' '),
      state: 'stage9',
    })
    setPhase('consenting')
    setError(null)
    popupRef.current = window.open(
      `${oauth.authorizeUrl}?${params.toString()}`,
      'carrier-consent',
      'width=520,height=680',
    )
  }

  async function handleComplete(code: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stage9/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, orderId: DEMO_ORDER_ID }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setResult(body.result)
      setPhase('linked')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('elicitation-required')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-8 px-6 py-16">
      <div className="flex w-full items-start justify-between">
        <div>
          <p className="text-accent-foreground text-sm font-medium">Stage 9</p>
          <h1 className="text-2xl font-semibold">Carrier account linking</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            agentgateway's own elicitation mechanism — a real third-party OAuth consent grant mid
            tool call, gated at the protocol level before carrier-mcp ever sees the request.
            Distinct from Stage 2's identity exchange and Stage 4's agent-level question.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          onClick={() => setFlowExpanded(!flowExpanded)}
          variant="ghost"
          size="sm"
          className="w-fit"
        >
          {flowExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {flowExpanded ? 'Hide request flow' : 'Show request flow'}
        </Button>
        {flowExpanded && <SequenceDiagram participants={SEQ_PARTICIPANTS} steps={SEQ_STEPS} />}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="size-4" /> 1. Schedule carrier pickup for {DEMO_ORDER_ID}
            </CardTitle>
            <CardDescription>
              The first attempt is gated: agentgateway returns a real 400 before carrier-mcp ever
              runs, because this customer has never linked a carrier account.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleLinkCarrier}
              disabled={busy || phase === 'linked'}
              className="w-fit"
            >
              {busy && phase === 'idle' ? 'Requesting…' : 'Link carrier account'}
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
            {phase === 'elicitation-required' && elicitation && (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-sm">
                  Elicitation pending — agentgateway needs this customer to grant carrier-portal
                  access before it will retry the call.
                </p>
                <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(
                    { resource: elicitation.resource, oauth: elicitation.oauth },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> 2. Consent via carrier-portal
            </CardTitle>
            <CardDescription>
              A real login against the carrier's OAuth server, in a popup — this app never sees the
              customer's carrier-portal password.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleOpenConsent}
              disabled={!elicitation || phase === 'linked' || busy}
              variant="secondary"
              className="w-fit"
            >
              <ExternalLink className="size-3.5" />
              {phase === 'consenting' ? 'Waiting for consent…' : 'Continue to carrier-portal'}
            </Button>
            {!elicitation && phase !== 'linked' && (
              <p className="text-muted-foreground text-sm">
                Attempt to link the carrier account first.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {phase === 'linked' && result && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Badge>Carrier account linked</Badge>
          <ArrowRight className="size-3.5" />
          {result.message}
        </p>
      )}

      <StageFooterNav onBack={onBack} onNext={onNext} nextLabel="Next: Multicluster" />
    </div>
  )
}

const SEQ_PARTICIPANTS = ['Customer', 'agentgateway', 'carrier-mcp', 'carrier-portal']

const SEQ_STEPS: SequenceStep[] = [
  { from: 'Customer', to: 'agentgateway', label: 'link_carrier_account(ORD-1001)' },
  {
    from: 'agentgateway',
    to: 'agentgateway',
    label: 'No banked carrier token — elicitation gate fires',
    self: true,
  },
  { from: 'agentgateway', to: 'Customer', label: '400 { url: elicitation info }' },
  { from: 'Customer', to: 'carrier-portal', label: 'Real OAuth consent (popup)' },
  { from: 'Customer', to: 'agentgateway', label: 'PUT /elicitations (real code)' },
  {
    from: 'agentgateway',
    to: 'carrier-portal',
    label: 'Exchanges the code server-side, banks token',
    self: true,
  },
  { from: 'Customer', to: 'agentgateway', label: 'Retries link_carrier_account' },
  { from: 'agentgateway', to: 'carrier-mcp', label: 'Forwards the call (token now banked)' },
  { from: 'carrier-mcp', to: 'Customer', label: 'Real success response' },
]
