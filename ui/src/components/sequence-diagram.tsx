import { motion } from 'framer-motion'

export interface SequenceStep {
  from: string
  to: string
  label: string
  self?: boolean
}

interface SequenceDiagramProps {
  participants: string[]
  steps: SequenceStep[]
}

/**
 * A from-scratch animated sequence diagram (not a diagramming library):
 * vertical lifelines, one per participant, with each step's arrow fading in
 * in order down the page so the actual temporal flow of a request reads
 * clearly, not just a static "who talks to whom".
 */
export function SequenceDiagram({ participants, steps }: SequenceDiagramProps) {
  const width = 640
  const rowHeight = 42
  const topPad = 50
  const height = topPad + steps.length * rowHeight + 16
  const colX = (name: string) => {
    const i = participants.indexOf(name)
    return participants.length === 1
      ? width / 2
      : 48 + (i / (participants.length - 1)) * (width - 96)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="border-border bg-card w-full overflow-x-auto rounded-xl border p-4"
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[560px]" role="img">
        <defs>
          <marker id="seq-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent-foreground)" />
          </marker>
        </defs>
        {participants.map((p) => (
          <g key={p}>
            <text
              x={colX(p)}
              y={16}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {p}
            </text>
            <line
              x1={colX(p)}
              y1={24}
              x2={colX(p)}
              y2={height - 8}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
          </g>
        ))}
        {steps.map((step, i) => {
          const y = topPad + i * rowHeight
          if (step.self) {
            const x = colX(step.from)
            return (
              <motion.g
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.35, duration: 0.3 }}
              >
                <text x={x + 14} y={y - 4} fontSize={10} fill="var(--muted-foreground)">
                  {step.label}
                </text>
                <path
                  d={`M ${x} ${y - 8} q 24 8 0 16`}
                  fill="none"
                  stroke="var(--accent-foreground)"
                  strokeWidth={1.5}
                  markerEnd="url(#seq-arrow)"
                />
              </motion.g>
            )
          }
          const x1 = colX(step.from)
          const x2 = colX(step.to)
          return (
            <motion.g
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.35, duration: 0.3 }}
            >
              <text
                x={(x1 + x2) / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {step.label}
              </text>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="var(--accent-foreground)"
                strokeWidth={1.5}
                markerEnd="url(#seq-arrow)"
              />
            </motion.g>
          )
        })}
      </svg>
    </motion.div>
  )
}
