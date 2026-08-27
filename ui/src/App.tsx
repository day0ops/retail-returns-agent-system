import { useState } from 'react'
import { Stage1Topology } from '@/pages/Stage1Topology'
import { Stage2TokenExchange } from '@/pages/Stage2TokenExchange'

// A lightweight state-based stage switcher, not a router -- with only two
// stages built so far a full routing library would be premature. Revisit
// once more stages land and deep-linking/back-button support starts to
// matter.
const STAGES = [Stage1Topology, Stage2TokenExchange] as const

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
