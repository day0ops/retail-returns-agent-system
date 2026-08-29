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

/**
 * A single real trace's span tree, Jaeger-style: one row per span, indented
 * by real parent/child depth, with a bar positioned/sized by that span's
 * actual offset and duration within the trace (not the page's own time
 * axis -- each trace has its own, usually millisecond-scale, timeline).
 */
export function TraceWaterfallCard({ trace }: { trace: TraceWaterfall }) {
  const totalUs = Math.max(...trace.spans.map((s) => s.offsetUs + s.durationUs), 1)
  const rootSpan = trace.spans[0]

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
        {trace.spans.map((s) => (
          <div key={s.spanId} className="flex items-center gap-2">
            <span
              className="text-muted-foreground w-36 shrink-0 truncate text-[10px]"
              style={{ paddingLeft: s.depth * 12 }}
              title={s.name}
            >
              {s.name}
            </span>
            <div className="bg-muted relative h-2.5 flex-1 overflow-hidden rounded-sm">
              <div
                className="bg-accent-foreground absolute inset-y-0 rounded-sm"
                style={{
                  left: `${(s.offsetUs / totalUs) * 100}%`,
                  width: `${Math.max((s.durationUs / totalUs) * 100, 1)}%`,
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
