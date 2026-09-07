import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PolicyViewObject {
  kind: string
  name: string
  namespace: string
  found: boolean
  spec?: unknown
}

/**
 * PolicySpecViewer shows spec: down for one or more already-provisioned
 * policy objects, fetched from a stage-policy-controller read-only view
 * (see its /policies/{name}/spec endpoint) -- unlike Stage 5's tool-policy
 * viewer, these objects aren't clickops apply/remove-able here, so this
 * only ever reads, and can show more than one object per view (e.g.
 * budget's cap + its separate enforcement policy).
 */
export function PolicySpecViewer({
  endpoint,
  toggleLabel = 'policy spec',
}: {
  endpoint: string
  toggleLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [objects, setObjects] = useState<PolicyViewObject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function fetchSpec() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setObjects(body.objects)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next) fetchSpec()
  }

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={toggle} variant="ghost" size="sm" className="w-fit">
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {expanded ? `Hide ${toggleLabel}` : `View ${toggleLabel}`}
      </Button>
      {expanded && (
        <div className="flex flex-col gap-3">
          {loading && <p className="text-muted-foreground text-xs">Loading…</p>}
          {error && <p className="text-destructive text-xs">{error}</p>}
          {objects?.map((obj) => (
            <div key={`${obj.namespace}/${obj.name}`} className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs">
                {obj.kind}{' '}
                <span className="font-mono">
                  {obj.namespace}/{obj.name}
                </span>
                {!obj.found && ' - not currently live'}
              </p>
              {obj.found && (
                <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
                  {JSON.stringify(obj.spec, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
