import { useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TourProgress } from '@/components/tour-progress'
import { Stage1Topology } from '@/pages/Stage1Topology'
import { Stage2TokenExchange } from '@/pages/Stage2TokenExchange'
import { Stage3A2AHandoff } from '@/pages/Stage3A2AHandoff'
import { Stage4Elicitation } from '@/pages/Stage4Elicitation'
import { Stage5ToolPolicy } from '@/pages/Stage5ToolPolicy'
import { Stage6Budget } from '@/pages/Stage6Budget'
import { Stage7Pii } from '@/pages/Stage7Pii'

// A lightweight state-based stage switcher, not a router -- with only seven
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
    </TooltipProvider>
  )
}

function AppHeader() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-6">
      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        Retail Returns Agent System
      </p>
    </div>
  )
}

export default App
