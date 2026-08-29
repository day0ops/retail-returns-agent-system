import { motion } from 'framer-motion'

export interface TimelineCall {
  type: 'mcp' | 'llm'
  timestampMs: number
  durationMs: number
  label: string
  status: string
  blocked: boolean
}

interface SessionTimelineProps {
  calls: TimelineCall[]
  windowStartMs: number
  windowEndMs: number
}

const LANES: Array<{ type: TimelineCall['type']; title: string }> = [
  { type: 'mcp', title: 'MCP' },
  { type: 'llm', title: 'LLM' },
]

/**
 * A from-scratch waterfall/timeline strip (not a charting library, same
 * approach as SequenceDiagram): one dot per real request, positioned by
 * when it actually happened and colored by outcome -- yellow for a normal
 * MCP call, red for one the tool-policy/budget guardrails blocked, muted
 * for an LLM call. Hover a dot for the exact backend/status/duration.
 */
export function SessionTimeline({ calls, windowStartMs, windowEndMs }: SessionTimelineProps) {
  const width = 640
  const laneHeight = 56
  const topPad = 24
  const height = topPad + LANES.length * laneHeight + 16

  const laneY = (type: TimelineCall['type']) => {
    const i = LANES.findIndex((l) => l.type === type)
    return topPad + i * laneHeight + laneHeight / 2
  }

  const xForTime = (ms: number) => {
    const span = windowEndMs - windowStartMs || 1
    const clamped = Math.min(Math.max(ms, windowStartMs), windowEndMs)
    return 16 + ((clamped - windowStartMs) / span) * (width - 32)
  }

  const formatTime = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="border-border bg-card w-full overflow-x-auto rounded-xl border p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[560px]" role="img">
        {LANES.map((lane) => (
          <g key={lane.type}>
            <text
              x={16}
              y={laneY(lane.type) - 18}
              fontSize={10}
              fontWeight={600}
              fill="var(--foreground)"
            >
              {lane.title}
            </text>
            <line
              x1={16}
              y1={laneY(lane.type)}
              x2={width - 16}
              y2={laneY(lane.type)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
          </g>
        ))}
        <text x={16} y={height - 4} fontSize={9} fill="var(--muted-foreground)">
          {formatTime(windowStartMs)}
        </text>
        <text
          x={width - 16}
          y={height - 4}
          fontSize={9}
          fill="var(--muted-foreground)"
          textAnchor="end"
        >
          {formatTime(windowEndMs)}
        </text>
        {calls.map((c, i) => {
          const color = c.blocked
            ? 'var(--destructive)'
            : c.type === 'mcp'
              ? 'var(--accent-foreground)'
              : 'var(--muted-foreground)'
          return (
            <motion.circle
              key={i}
              cx={xForTime(c.timestampMs)}
              cy={laneY(c.type)}
              r={4}
              fill={color}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.02, 1), duration: 0.2 }}
            >
              <title>
                {`${c.label} -- ${c.status || 'n/a'}${c.blocked ? ' (blocked)' : ''} -- ${c.durationMs}ms`}
              </title>
            </motion.circle>
          )
        })}
      </svg>
    </div>
  )
}
