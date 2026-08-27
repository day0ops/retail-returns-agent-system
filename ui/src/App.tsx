import { useState } from 'react'
import { Stage1Topology } from '@/pages/Stage1Topology'
import { Stage2TokenExchange } from '@/pages/Stage2TokenExchange'
import { Stage3A2AHandoff } from '@/pages/Stage3A2AHandoff'
import { Stage4Elicitation } from '@/pages/Stage4Elicitation'

// A lightweight state-based stage switcher, not a router -- with only four
// stages built so far a full routing library would be premature. Revisit
// once more stages land and deep-linking/back-button support starts to
// matter. Page order here is the tour's presentation order, not the design
// doc's capability-stage numbering (e.g. Stage3A2AHandoff is capability
// "Stage 7"; Stage4Elicitation is capability "Stage 3") -- each page's own
// badge shows its real capability number.
const STAGES = [Stage1Topology, Stage2TokenExchange, Stage3A2AHandoff, Stage4Elicitation] as const

function App() {
  const [stageIndex, setStageIndex] = useState(0)
  const Stage = STAGES[stageIndex]

  return (
    <Stage
      onNext={stageIndex < STAGES.length - 1 ? () => setStageIndex(stageIndex + 1) : undefined}
    />
  )
}

export default App
