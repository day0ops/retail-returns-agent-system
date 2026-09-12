import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeToggle } from '@/components/theme-toggle'
import { TourProgress } from '@/components/tour-progress'
import { Stage1Topology } from '@/pages/Stage1Topology'
import { Stage2TokenExchange } from '@/pages/Stage2TokenExchange'
import { Stage3A2AHandoff } from '@/pages/Stage3A2AHandoff'
import { Stage4Elicitation } from '@/pages/Stage4Elicitation'
import { Stage5ToolPolicy } from '@/pages/Stage5ToolPolicy'
import { Stage6Budget } from '@/pages/Stage6Budget'
import { Stage7Pii } from '@/pages/Stage7Pii'
import { Stage8Telemetry } from '@/pages/Stage8Telemetry'
import { Stage9CarrierElicitation } from '@/pages/Stage9CarrierElicitation'
import { Stage10Multicluster } from '@/pages/Stage10Multicluster'

// A lightweight state-based stage switcher, not a router -- with only ten
// stages built so far a full routing library would be premature. Revisit
// once more stages land and deep-linking starts to matter. Page order here
// is the tour's presentation order; each page's own "Stage N" badge matches
// that position (not the original design doc's capability numbering, which
// had built these out of presentation order -- e.g. Stage3A2AHandoff was
// originally capability "Stage 7").
const STAGES = [
  Stage1Topology,
  Stage2TokenExchange,
  Stage3A2AHandoff,
  Stage4Elicitation,
  Stage5ToolPolicy,
  Stage6Budget,
  Stage7Pii,
  Stage8Telemetry,
  Stage9CarrierElicitation,
  Stage10Multicluster,
] as const

function App() {
  const [stageIndex, setStageIndex] = useState(0)
  const Stage = STAGES[stageIndex]

  return (
    <TooltipProvider>
      <AppHeader />
      <TourProgress current={stageIndex} total={STAGES.length} />
      <Stage
        onNext={stageIndex < STAGES.length - 1 ? () => setStageIndex(stageIndex + 1) : undefined}
        onBack={stageIndex > 0 ? () => setStageIndex(stageIndex - 1) : undefined}
      />
      <AppFooter />
    </TooltipProvider>
  )
}

// Logout + theme toggle live here (rendered once, on every stage) rather than each
// stage page rendering its own -- previously only Stage 1's footer had a logout button,
// so leaving the tour meant navigating all the way back to the first stage.
function AppHeader() {
  // Clears this app's own cached identity first, then navigates to /logout so
  // agentgateway's ExtAuth (when a gate is actually in front of this app) can end
  // the real Keycloak SSO session server-side before landing back here. Falls
  // through to this app's own /logout fallback when there's no gate (local/dev).
  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST' })
    } finally {
      window.location.href = '/logout'
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6">
      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        Retail Returns Agent System
      </p>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button onClick={handleLogout} variant="ghost" size="sm">
          <LogOut className="size-3.5" /> Logout
        </Button>
      </div>
    </div>
  )
}

// Shows which build is actually running -- the git tag on a release build,
// short SHA otherwise (see ui/Dockerfile and build-images.yml), 'dev' for
// local dev with no image build at all. Silent on fetch failure: a missing
// version string isn't worth surfacing an error over.
function AppFooter() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/version')
      .then((res) => res.json())
      .then((body) => setVersion(body.version))
      .catch(() => {})
  }, [])

  if (!version) return null

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-4 text-center">
      <p className="text-muted-foreground text-[11px]">{version}</p>
    </div>
  )
}

export default App
