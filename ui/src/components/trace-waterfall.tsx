export interface WaterfallSpan {
  spanId: string
  name: string
  depth: number
  offsetUs: number
  durationUs: number
}

export interface TraceWaterfall {
  traceId: string
  protocol: 'mcp' | 'llm'
  spans: WaterfallSpan[]
}

function formatMs(us: number) {
  return `${(us / 1000).toFixed(us < 1000 ? 2 : 1)}ms`
}

// Tempo/Jaeger color spans by service; every span here comes from the same
// service (agentgateway's own view of the hop), so that dimension wouldn't
// actually differentiate anything -- color by logical branch instead (the
// root span, and each depth-1 child's own subtree) so it's visually obvious
// which spans belong to the tool call vs. the Guardrail check vs. any other
// sibling operation.
const PALETTE = [
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
]

function colorForKey(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function branchColors(spans: WaterfallSpan[]): string[] {
  let currentBranch = ''
  return spans.map((s) => {
    if (s.depth <= 1) currentBranch = s.name
    return colorForKey(currentBranch)
  })
}

/**
 * A single real trace's span tree, Jaeger-style: one row per span, indented
 * by real parent/child depth, with a bar positioned/sized by that span's
 * actual offset and duration within the trace (not the page's own time
 * axis -- each trace has its own, usually millisecond-scale, timeline).
 */
export function TraceWaterfallCard({ trace }: { trace: TraceWaterfall }) {
  const totalUs = Math.max(...trace.spans.map((s) => s.offsetUs + s.durationUs), 1)
  const rootSpan = trace.spans[0]
  const colors = branchColors(trace.spans)

  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 truncate text-xs font-medium">
          <span
            className={
              trace.protocol === 'mcp'
                ? 'bg-accent-foreground size-1.5 shrink-0 rounded-full'
                : 'bg-muted-foreground size-1.5 shrink-0 rounded-full'
            }
          />
          {rootSpan?.name ?? trace.traceId}
        </span>
        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {formatMs(totalUs)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {trace.spans.map((s, i) => (
          <div key={s.spanId} className="flex items-center gap-2">
            <span
              className="flex w-36 shrink-0 items-center gap-1.5 truncate text-[10px]"
              style={{ paddingLeft: s.depth * 12 }}
              title={s.name}
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: colors[i] }}
              />
              <span className="text-muted-foreground truncate">{s.name}</span>
            </span>
            <div className="bg-muted relative h-2.5 flex-1 overflow-hidden rounded-sm">
              <div
                className="absolute inset-y-0 rounded-sm"
                style={{
                  left: `${(s.offsetUs / totalUs) * 100}%`,
                  width: `${Math.max((s.durationUs / totalUs) * 100, 1)}%`,
                  backgroundColor: colors[i],
                }}
              />
            </div>
            <span className="text-muted-foreground w-14 shrink-0 text-right font-mono text-[10px]">
              {formatMs(s.durationUs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
